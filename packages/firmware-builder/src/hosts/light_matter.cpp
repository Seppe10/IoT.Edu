#include "light_matter.h"

#include "photosensitive_sensor.h"

#include <sdkconfig.h>
#include <esp_log.h>
#include <esp_matter.h>

using namespace esp_matter;
using namespace esp_matter::endpoint;

static const char *TAG = "light_matter";

#if CONFIG_IOTEDU_LIGHT_ADC_GPIO != 4
#error "Photosensitive revision 2 reads ADC channel 3, which is GPIO 4 on this ESP32-H2 target"
#endif

esp_err_t iotedu_light_prepare(esp_matter::node_t *node, uint16_t *endpoint_id)
{
    if (node == nullptr || endpoint_id == nullptr) {
        return ESP_ERR_INVALID_ARG;
    }
    light_sensor::config_t config;
    config.illuminance_measurement.measured_value = nullable<uint16_t>();
    config.illuminance_measurement.min_measured_value = nullable<uint16_t>(1);
    config.illuminance_measurement.max_measured_value = nullable<uint16_t>(0xFFFE);
    endpoint_t *endpoint = light_sensor::create(node, &config, ENDPOINT_FLAG_NONE, NULL);
    if (endpoint == nullptr) {
        ESP_LOGE(TAG, "Failed to create the light sensor endpoint");
        return ESP_FAIL;
    }
    *endpoint_id = endpoint::get_id(endpoint);
    ESP_LOGI(TAG, "Light sensor endpoint %u. ADC channel 3 is GPIO %d.", *endpoint_id, CONFIG_IOTEDU_LIGHT_ADC_GPIO);
    return ESP_OK;
}

esp_err_t iotedu_light_start(uint16_t endpoint_id)
{
    // Matter is already running, so the driver can schedule illuminance updates on that context.
    return photosensitive_sensor_init(endpoint_id);
}
