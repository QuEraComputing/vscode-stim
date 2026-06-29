#include <emscripten/bind.h>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "stim/circuit/circuit.h"
#include "stim/dem/detector_error_model.h"
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

static std::string diagram(std::string circuit_text, std::string type, int tick) {
    try {
        Circuit circuit{std::string_view(circuit_text)};
        std::vector<CoordFilter> filters;
        filters.push_back(CoordFilter{});
        SpanRef<const CoordFilter> coord_filter(filters);
        uint64_t tick_start = (uint64_t)(tick < 0 ? 0 : tick);
        uint64_t tick_num = 1;
        std::ostringstream out;
        if (type == "timeline-svg") {
            DiagramTimelineSvgDrawer::make_diagram_write_to(
                circuit, out, 0, UINT64_MAX,
                DiagramTimelineSvgDrawerMode::SVG_MODE_TIMELINE, coord_filter);
        } else if (type == "timeslice-svg") {
            DiagramTimelineSvgDrawer::make_diagram_write_to(
                circuit, out, tick_start, tick_num,
                DiagramTimelineSvgDrawerMode::SVG_MODE_TIME_SLICE, coord_filter);
        } else if (type == "detslice-with-ops-svg") {
            DiagramTimelineSvgDrawer::make_diagram_write_to(
                circuit, out, tick_start, tick_num,
                DiagramTimelineSvgDrawerMode::SVG_MODE_TIME_DETECTOR_SLICE, coord_filter);
        } else if (type == "detslice-svg") {
            DetectorSliceSet::from_circuit_ticks(
                circuit, tick_start, tick_num, coord_filter)
                .write_svg_diagram_to(out);
        } else if (type == "matchgraph-svg") {
            DetectorErrorModel dem = ErrorAnalyzer::circuit_to_detector_error_model(
                circuit, false, true, false, 0, false, false);
            dem_match_graph_to_svg_diagram_write_to(dem, out);
        } else {
            throw std::invalid_argument("Unknown diagram type: " + type);
        }
        return out.str();
    } catch (const std::exception &e) {
        return ERROR_PREFIX + e.what();
    } catch (...) {
        return ERROR_PREFIX + std::string("unknown error generating diagram");
    }
}

EMSCRIPTEN_BINDINGS(stim_diagram) {
    function("diagram", &diagram);
}
