#include <emscripten/bind.h>
#include <cstdio>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "stim/circuit/circuit.h"
#include "stim/dem/detector_error_model.h"
#include "stim/gates/gates.h"
#include "stim/simulators/error_analyzer.h"
#include "stim/diagram/coord.h"
#include "stim/diagram/timeline/timeline_svg_drawer.h"
#include "stim/diagram/detector_slice/detector_slice_set.h"
#include "stim/diagram/graph/match_graph_svg_drawer.h"

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
            circuit, false, true, false, 0, false, false);
        dem_match_graph_to_svg_diagram_write_to(dem, out);
    } else {
        throw std::invalid_argument("Unknown diagram type: " + type);
    }
}

// A single slice/diagram at one tick.
static std::string diagram(std::string circuit_text, std::string type, int tick, bool without_noise) {
    try {
        Circuit circuit{std::string_view(circuit_text)};
        if (without_noise) {
            circuit = circuit.without_noise();
        }
        uint64_t tick_start = (uint64_t)(tick < 0 ? 0 : tick);
        std::ostringstream out;
        render_to(circuit, type, tick_start, 1, 0, out);
        return out.str();
    } catch (const std::exception &e) {
        return ERROR_PREFIX + e.what();
    } catch (...) {
        return ERROR_PREFIX + std::string("unknown error generating diagram");
    }
}

// The whole circuit's ticks in one diagram, laid out in `rows` rows (0 = auto).
static std::string diagram_full(std::string circuit_text, std::string type, int rows, bool without_noise) {
    try {
        Circuit circuit{std::string_view(circuit_text)};
        if (without_noise) {
            circuit = circuit.without_noise();
        }
        size_t num_rows = rows < 0 ? 0 : (size_t)rows;
        std::ostringstream out;
        render_to(circuit, type, 0, UINT64_MAX, num_rows, out);
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
        json_escape_to(g.category ? g.category : "", out);
        out += "\",\"args\":";
        out += std::to_string((int)g.arg_count);
        out += ",\"help\":\"";
        json_escape_to(g.help ? g.help : "", out);
        out += "\"}";
    }
    out += "]";
    return out;
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

EMSCRIPTEN_BINDINGS(stim_diagram) {
    function("diagram", &diagram);
    function("diagram_full", &diagram_full);
    function("count_ticks", &count_ticks);
    function("gate_data_json", &gate_data_json);
}
