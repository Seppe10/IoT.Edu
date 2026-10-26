#include "dht11_matter.h"

#include "dht11.h"
#include "iotedu_dht11_ranges.h"

#include <sdkconfig.h>
#include <esp_log.h>
#include <esp_matter.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

using namespace esp_matter;
using namespace esp_matter::attribute;
using namespace esp_matter::endpoint;
using namespace chip::app::Clusters;

static const char *TAG = "dht11_matter";

typedef struct {
    uint16_t temperature_endpoint_id;
    uint16_t humidity_endpoint_id;
} dht11_matter_config_t;

static void temp_sensor_notification(uint16_t endpoint_id, float temp)
{
    chip::DeviceLayer::SystemLayer().ScheduleLambda([endpoint_id, temp]() {
        attribute_t *attribute = attribute::get(endpoint_id,
                                                TemperatureMeasurement::Id,
                                                TemperatureMeasurement::Attributes::MeasuredValue::Id);
        if (attribute == nullptr) {
            return;
        }
        esp_matter_attr_val_t val = esp_matter_invalid(NULL);
        attribute::get_val(attribute, &val);
        val.val.i16 = static_cast<int16_t>(temp * 100);
        attribute::update(endpoint_id, TemperatureMeasurement::Id, TemperatureMeasurement::Attributes::MeasuredValue::Id, &val);
    });
}

static void humidity_sensor_notification(uint16_t endpoint_id, float humidity)
{
    chip::DeviceLayer::SystemLayer().ScheduleLambda([endpoint_id, humidity]() {
        attribute_t *attribute = attribute::get(endpoint_id,
                                                RelativeHumidityMeasurement::Id,
                                                RelativeHumidityMeasurement::Attributes::MeasuredValue::Id);
        if (attribute == nullptr) {
            return;
        }
        esp_matter_attr_val_t val = esp_matter_invalid(NULL);
        attribute::get_val(attribute, &val);
        val.val.u16 = static_cast<uint16_t>(humidity * 100);
        attribute::update(endpoint_id, RelativeHumidityMeasurement::Id,
                          RelativeHumidityMeasurement::Attributes::MeasuredValue::Id, &val);
    });
}

static void dht11_task(void *arg)
{
    dht11_matter_config_t *config = static_cast<dht11_matter_config_t *>(arg);

    vTaskDelay(pdMS_TO_TICKS(2000));

    while (true) {
        dht11_reading_t reading = {};
        esp_err_t err = dht11_read(&reading);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "DHT11 temperature %d C, humidity %u%%", reading.temperature, reading.humidity);
            if (iotedu_dht11_temperature_acceptable(reading.temperature)) {
                temp_sensor_notification(config->temperature_endpoint_id, static_cast<float>(reading.temperature));
            } else {
                ESP_LOGW(TAG, "DHT11 temperature %d C is outside %d-%d C and was not reported",
                         reading.temperature, IOTEDU_DHT11_TEMP_MIN_C, IOTEDU_DHT11_TEMP_MAX_C);
            }
            if (iotedu_dht11_humidity_acceptable(reading.humidity)) {
                humidity_sensor_notification(config->humidity_endpoint_id, static_cast<float>(reading.humidity));
            } else {
                ESP_LOGW(TAG, "DHT11 humidity %u%% is outside %d-%d%% and was not reported",
                         reading.humidity, IOTEDU_DHT11_HUMIDITY_MIN_PERCENT, IOTEDU_DHT11_HUMIDITY_MAX_PERCENT);
            }
        } else {
            ESP_LOGW(TAG, "DHT11 read failed: %s", esp_err_to_name(err));
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

esp_err_t iotedu_dht11_register(esp_matter::node_t *node)
{
    if (node == nullptr) {
        return ESP_ERR_INVALID_ARG;
    }

    temperature_sensor::config_t temp_sensor_config;
    temp_sensor_config.temperature_measurement.measured_value = nullable<int16_t>();
    temp_sensor_config.temperature_measurement.min_measured_value = nullable<int16_t>(IOTEDU_DHT11_TEMP_MIN_CENTI);
    temp_sensor_config.temperature_measurement.max_measured_value = nullable<int16_t>(IOTEDU_DHT11_TEMP_MAX_CENTI);
    endpoint_t *temp_sensor_ep = temperature_sensor::create(node, &temp_sensor_config, ENDPOINT_FLAG_NONE, NULL);
    if (temp_sensor_ep == nullptr) {
        ESP_LOGE(TAG, "Failed to create the temperature endpoint");
        return ESP_FAIL;
    }

    humidity_sensor::config_t humidity_sensor_config;
    humidity_sensor_config.relative_humidity_measurement.measured_value = nullable<uint16_t>();
    humidity_sensor_config.relative_humidity_measurement.min_measured_value = nullable<uint16_t>(IOTEDU_DHT11_HUMIDITY_MIN_CENTI);
    humidity_sensor_config.relative_humidity_measurement.max_measured_value = nullable<uint16_t>(IOTEDU_DHT11_HUMIDITY_MAX_CENTI);
    endpoint_t *humidity_sensor_ep = humidity_sensor::create(node, &humidity_sensor_config, ENDPOINT_FLAG_NONE, NULL);
    if (humidity_sensor_ep == nullptr) {
        ESP_LOGE(TAG, "Failed to create the humidity endpoint");
        return ESP_FAIL;
    }

    const gpio_num_t pin = static_cast<gpio_num_t>(CONFIG_IOTEDU_DHT11_PIN);
    ESP_LOGI(TAG, "Initialising DHT11 on GPIO%d", static_cast<int>(pin));
    esp_err_t err = dht11_init_pin(pin);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "DHT11 initialisation failed on GPIO%d: %s", static_cast<int>(pin), esp_err_to_name(err));
        return err;
    }

    static dht11_matter_config_t dht11_config = {
        .temperature_endpoint_id = endpoint::get_id(temp_sensor_ep),
        .humidity_endpoint_id = endpoint::get_id(humidity_sensor_ep),
    };
    if (xTaskCreate(dht11_task, "dht11_task", 4096, &dht11_config, 5, NULL) != pdPASS) {
        ESP_LOGE(TAG, "Failed to start the DHT11 reading task");
        return ESP_FAIL;
    }
    return ESP_OK;
}
