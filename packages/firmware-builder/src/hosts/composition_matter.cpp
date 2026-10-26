#include "composition_matter.h"

#include <esp_log.h>

static const char *TAG = "composition";

// esp_matter's private node object starts with the endpoint list pointer, then the next
// dynamic endpoint id. On the ESP32-H2 ILP32 target that id is at offset 4. The value is
// written only when it already equals the endpoint being retired, so a layout mismatch
// does not overwrite an unrelated field. Creation happens before esp_matter::start reads
// the NVS counter, so this is what stops a new function from receiving endpoint 1.
struct iotedu_endpoint_allocator {
    void *endpoint_list;
    uint16_t min_unused_endpoint_id;
};

esp_err_t iotedu_composition_reserve(esp_matter::node_t *node, uint16_t endpoint_id)
{
    if (node == nullptr || endpoint_id == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    auto *allocator = reinterpret_cast<iotedu_endpoint_allocator *>(node);
    const uint16_t next = allocator->min_unused_endpoint_id;
    ESP_LOGI(TAG, "Endpoint allocator is %u. Endpoint %u is retired and must not be reused.", next, endpoint_id);
    if (next != endpoint_id) {
        ESP_LOGW(TAG, "Endpoint %u was not reserved because the allocator is %u. The new function keeps the id it is given.", endpoint_id, next);
        return ESP_OK;
    }
    allocator->min_unused_endpoint_id = static_cast<uint16_t>(endpoint_id + 1);
    ESP_LOGI(TAG, "Retired endpoint %u stays unused. The next function endpoint starts at %u.", endpoint_id, allocator->min_unused_endpoint_id);
    return ESP_OK;
}
