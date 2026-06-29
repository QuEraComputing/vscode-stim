#include <emscripten/bind.h>
#include <cstdio>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "stim/circuit/circuit.h"
#include "stim/dem/detector_error_model.h"
#include "stim/gates/gates.h"
#include "stim/search/graphlike/algo.h"
#include "stim/simulators/error_analyzer.h"
#include "stim/diagram/coord.h"
#include "stim/diagram/gltf.h"
#include "stim/diagram/basic_3d_diagram.h"
#include "stim/diagram/timeline/timeline_svg_drawer.h"
#include "stim/diagram/timeline/timeline_3d_drawer.h"
#include "stim/diagram/detector_slice/detector_slice_set.h"
#include "stim/diagram/graph/match_graph_svg_drawer.h"
#include "stim/diagram/graph/match_graph_3d_drawer.h"

using namespace emscripten;
using namespace stim;
using namespace stim_draw_internal;

// NOTE: write the leading control char as its own literal then concatenate.
// "\x01ERROR" would be parsed as the hex escape \x01E (0x1E) followed by "RROR",
// because C++ hex escapes greedily consume every following hex digit.
static const std::string ERROR_PREFIX = "\x01" "ERROR" "\x01";

// Render a diagram over a tick range into `out`. Slice diagrams (timeslice /
// detslice / detslice-with-ops) honour [tick_start, tick_num) and lay multiple
// ticks out in `num_rows` rows (0 = stim's automatic layout). Timeline always
// covers the whole circuit; matchgraph ignores ticks.
static void render_to(
    const Circuit &circuit,
    const std::string &type,
    uint64_t tick_start,
    uint64_t tick_num,
    size_t num_rows,
    double approx_disjoint_threshold,
    bool decompose_errors,
    std::ostream &out) {
    std::vector<CoordFilter> filters;
    filters.push_back(CoordFilter{});
    SpanRef<const CoordFilter> coord_filter(filters);
    if (type == "timeline-svg") {
        DiagramTimelineSvgDrawer::make_diagram_write_to(
            circuit, out, 0, UINT64_MAX,
            DiagramTimelineSvgDrawerMode::SVG_MODE_TIMELINE, coord_filter, num_rows);
    } else if (type == "timeslice-svg") {
        DiagramTimelineSvgDrawer::make_diagram_write_to(
            circuit, out, tick_start, tick_num,
            DiagramTimelineSvgDrawerMode::SVG_MODE_TIME_SLICE, coord_filter, num_rows);
    } else if (type == "detslice-with-ops-svg") {
        DiagramTimelineSvgDrawer::make_diagram_write_to(
            circuit, out, tick_start, tick_num,
            DiagramTimelineSvgDrawerMode::SVG_MODE_TIME_DETECTOR_SLICE, coord_filter, num_rows);
    } else if (type == "detslice-svg") {
        DetectorSliceSet::from_circuit_ticks(circuit, tick_start, tick_num, coord_filter)
            .write_svg_diagram_to(out, num_rows);
    } else if (type == "matchgraph-svg") {
        DetectorErrorModel dem = ErrorAnalyzer::circuit_to_detector_error_model(
            circuit, decompose_errors, true, false, approx_disjoint_threshold, false, false);
        dem_match_graph_to_svg_diagram_write_to(dem, out);
    } else if (type == "timeline-3d-html") {
        std::ostringstream gltf;
        DiagramTimeline3DDrawer::circuit_to_basic_3d_diagram(circuit)
            .to_gltf_scene()
            .to_json()
            .write(gltf);
        write_html_viewer_for_gltf_data(gltf.str(), out);
    } else if (type == "matchgraph-3d-html") {
        DetectorErrorModel dem = ErrorAnalyzer::circuit_to_detector_error_model(
            circuit, decompose_errors, true, false, approx_disjoint_threshold, false, false);
        std::ostringstream gltf;
        dem_match_graph_to_basic_3d_diagram(dem).to_gltf_scene().to_json().write(gltf);
        write_html_viewer_for_gltf_data(gltf.str(), out);
    } else {
        throw std::invalid_argument("Unknown diagram type: " + type);
    }
}

// `approx_disjoint` enables stim's approximate_disjoint_errors when building the
// detector error model for match graphs (threshold 1.0); off uses 0.0.
static double disjoint_threshold(bool approx_disjoint) {
    return approx_disjoint ? 1.0 : 0.0;
}

// A single slice/diagram at one tick.
static std::string diagram(
    std::string circuit_text, std::string type, int tick, bool without_noise,
    bool approx_disjoint, bool decompose_errors) {
    try {
        Circuit circuit{std::string_view(circuit_text)};
        if (without_noise) {
            circuit = circuit.without_noise();
        }
        uint64_t tick_start = (uint64_t)(tick < 0 ? 0 : tick);
        std::ostringstream out;
        render_to(circuit, type, tick_start, 1, 0, disjoint_threshold(approx_disjoint),
                  decompose_errors, out);
        return out.str();
    } catch (const std::exception &e) {
        return ERROR_PREFIX + e.what();
    } catch (...) {
        return ERROR_PREFIX + std::string("unknown error generating diagram");
    }
}

// The whole circuit's ticks in one diagram, laid out in `rows` rows (0 = auto).
static std::string diagram_full(
    std::string circuit_text, std::string type, int rows, bool without_noise,
    bool approx_disjoint, bool decompose_errors) {
    try {
        Circuit circuit{std::string_view(circuit_text)};
        if (without_noise) {
            circuit = circuit.without_noise();
        }
        size_t num_rows = rows < 0 ? 0 : (size_t)rows;
        std::ostringstream out;
        render_to(circuit, type, 0, UINT64_MAX, num_rows, disjoint_threshold(approx_disjoint),
                  decompose_errors, out);
        return out.str();
    } catch (const std::exception &e) {
        return ERROR_PREFIX + e.what();
    } catch (...) {
        return ERROR_PREFIX + std::string("unknown error generating diagram");
    }
}

static void json_escape_to(std::string_view s, std::string &out) {
    for (char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if ((unsigned char)c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", (unsigned)(unsigned char)c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
}

// Match-graph diagram drawn directly from a detector error model (.dem). The
// circuit-only options (noise, approximate_disjoint, decompose) don't apply
// here; the DEM already fixes the error structure.
static std::string dem_diagram(std::string dem_text, std::string type) {
    try {
        DetectorErrorModel dem{std::string_view(dem_text)};
        std::ostringstream out;
        if (type == "matchgraph-svg") {
            dem_match_graph_to_svg_diagram_write_to(dem, out);
        } else if (type == "matchgraph-3d-html") {
            std::ostringstream gltf;
            dem_match_graph_to_basic_3d_diagram(dem).to_gltf_scene().to_json().write(gltf);
            write_html_viewer_for_gltf_data(gltf.str(), out);
        } else {
            throw std::invalid_argument("Unsupported DEM diagram type: " + type);
        }
        return out.str();
    } catch (const std::exception &e) {
        return ERROR_PREFIX + e.what();
    } catch (...) {
        return ERROR_PREFIX + std::string("unknown error generating diagram");
    }
}

// Summary counts for a detector error model, including the shortest graphlike
// undetectable logical error (the graphlike code distance), or -1 if it cannot
// be computed (e.g. no logical observable / no such error).
static std::string dem_stats_to_json(const DetectorErrorModel &dem) {
    long long shortest = -1;
    try {
        DetectorErrorModel e =
            stim::shortest_graphlike_undetectable_logical_error(dem, true);
        shortest = (long long)e.count_errors();
    } catch (...) {
        shortest = -1;
    }
    std::string out = "{";
    out += "\"detectors\":" + std::to_string((uint64_t)dem.count_detectors());
    out += ",\"observables\":" + std::to_string((uint64_t)dem.count_observables());
    out += ",\"errors\":" + std::to_string((uint64_t)dem.count_errors());
    out += ",\"shortestGraphlikeError\":" + std::to_string(shortest);
    out += "}";
    return out;
}

static std::string error_json(const char *what) {
    std::string out = "{\"error\":\"";
    json_escape_to(what, out);
    out += "\"}";
    return out;
}

// Stats for a detector error model given as .dem text.
static std::string dem_stats_json(std::string dem_text) {
    try {
        DetectorErrorModel dem{std::string_view(dem_text)};
        return dem_stats_to_json(dem);
    } catch (const std::exception &e) {
        return error_json(e.what());
    }
}

// DEM stats for a circuit: build its detector error model (honouring the same
// options as the match graph) and report its counts. Powers the extra DEM rows
// shown when the match graph is selected for a circuit.
static std::string circuit_dem_stats_json(
    std::string circuit_text, bool approx_disjoint, bool decompose_errors) {
    try {
        Circuit c{std::string_view(circuit_text)};
        DetectorErrorModel dem = ErrorAnalyzer::circuit_to_detector_error_model(
            c, decompose_errors, true, false, disjoint_threshold(approx_disjoint), false, false);
        return dem_stats_to_json(dem);
    } catch (const std::exception &e) {
        return error_json(e.what());
    }
}

// Returns stim's full gate/annotation table as JSON: an array of
// {name, category, args, help}. Drives editor autocomplete so the completion
// list always matches the compiled stim version.
static std::string gate_data_json() {
    std::string out = "[";
    bool first = true;
    for (const auto &g : GATE_DATA.items) {
        if (g.name.empty()) {
            continue;
        }
        if (!first) {
            out += ",";
        }
        first = false;
        out += "{\"name\":\"";
        json_escape_to(g.name, out);
        out += "\",\"category\":\"";
        json_escape_to(g.category, out);
        out += "\",\"args\":";
        out += std::to_string((int)g.arg_count);
        out += ",\"help\":\"";
        json_escape_to(g.help, out);
        out += "\"}";
    }
    out += "]";
    return out;
}

// Returns the circuit text with all noise operations removed (stim's
// Circuit::without_noise), preserving gate tags. Lets the tsim relabel path
// strip user noise before inserting I_ERROR placeholders.
static std::string without_noise_text(std::string circuit_text) {
    try {
        Circuit c{std::string_view(circuit_text)};
        std::ostringstream out;
        out << c.without_noise();
        return out.str();
    } catch (const std::exception &e) {
        return ERROR_PREFIX + e.what();
    }
}

// Returns the number of TICK instructions in the circuit, or -1 if the
// circuit text cannot be parsed. Used to drive "full mode" (one slice per tick).
static int count_ticks(std::string circuit_text) {
    try {
        Circuit circuit{std::string_view(circuit_text)};
        return (int)circuit.count_ticks();
    } catch (...) {
        return -1;
    }
}

// Returns the circuit's summary counts as JSON, or {"error": "..."} if it
// cannot be parsed. Drives the toolbar info tooltip.
static std::string circuit_stats_json(std::string circuit_text) {
    try {
        Circuit c{std::string_view(circuit_text)};
        std::string out = "{";
        out += "\"qubits\":" + std::to_string((uint64_t)c.count_qubits());
        out += ",\"measurements\":" + std::to_string((uint64_t)c.count_measurements());
        out += ",\"detectors\":" + std::to_string((uint64_t)c.count_detectors());
        out += ",\"observables\":" + std::to_string((uint64_t)c.count_observables());
        out += ",\"ticks\":" + std::to_string((uint64_t)c.count_ticks());
        out += ",\"sweepBits\":" + std::to_string((uint64_t)c.count_sweep_bits());
        out += "}";
        return out;
    } catch (const std::exception &e) {
        std::string out = "{\"error\":\"";
        json_escape_to(e.what(), out);
        out += "\"}";
        return out;
    }
}

EMSCRIPTEN_BINDINGS(stim_diagram) {
    function("diagram", &diagram);
    function("diagram_full", &diagram_full);
    function("count_ticks", &count_ticks);
    function("without_noise_text", &without_noise_text);
    function("circuit_stats_json", &circuit_stats_json);
    function("dem_diagram", &dem_diagram);
    function("dem_stats_json", &dem_stats_json);
    function("circuit_dem_stats_json", &circuit_dem_stats_json);
    function("gate_data_json", &gate_data_json);
}
