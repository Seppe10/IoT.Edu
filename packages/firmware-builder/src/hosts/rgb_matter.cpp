#include "rgb_matter.h"

#include "rgb_led.h"

#include <sdkconfig.h>
#include <esp_log.h>
#include <esp_matter.h>

using namespace esp_matter;
using namespace esp_matter::attribute;
using namespace esp_matter::endpoint;
using namespace chip::app::Clusters;

static const char *TAG = "rgb_matter";
static uint16_t light_endpoint_id = 0;
static bool driver_ready = false;
static uint16_t current_x = 0;
static uint16_t current_y = 0;

static esp_err_t read_attribute(uint16_t endpoint_id, uint32_t cluster_id, uint32_t attribute_id, esp_matter_attr_val_t *value)
{
    attribute_t *attribute = attribute::get(endpoint_id, cluster_id, attribute_id);
    if (attribute == nullptr) {
        ESP_LOGE(TAG, "Attribute 0x%08lx was not found on endpoint %u cluster 0x%08lx",
                 static_cast<unsigned long>(attribute_id), endpoint_id, static_cast<unsigned long>(cluster_id));
        return ESP_ERR_NOT_FOUND;
    }
    return attribute::get_val(attribute, value);
}

static esp_err_t apply_colour(uint16_t endpoint_id)
{
    esp_matter_attr_val_t mode = esp_matter_invalid(NULL);
    esp_err_t err = read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::ColorMode::Id, &mode);
    if (err != ESP_OK) {
        return err;
    }
    esp_matter_attr_val_t value = esp_matter_invalid(NULL);
    if (mode.val.u8 == static_cast<uint8_t>(ColorControl::ColorMode::kCurrentHueAndCurrentSaturation)) {
        esp_matter_attr_val_t saturation = esp_matter_invalid(NULL);
        err = read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentHue::Id, &value);
        if (err != ESP_OK) return err;
        err = read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentSaturation::Id, &saturation);
        if (err != ESP_OK) return err;
        return rgb_led_set_hsv(value.val.u8, saturation.val.u8);
    }
    if (mode.val.u8 == static_cast<uint8_t>(ColorControl::ColorMode::kColorTemperature)) {
        err = read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::ColorTemperatureMireds::Id, &value);
        if (err != ESP_OK) return err;
        return rgb_led_set_color_temperature(value.val.u16);
    }
    if (mode.val.u8 == static_cast<uint8_t>(ColorControl::ColorMode::kCurrentXAndCurrentY)) {
        esp_matter_attr_val_t y_value = esp_matter_invalid(NULL);
        err = read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentX::Id, &value);
        if (err != ESP_OK) return err;
        err = read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentY::Id, &y_value);
        if (err != ESP_OK) return err;
        current_x = value.val.u16;
        current_y = y_value.val.u16;
        return rgb_led_set_xy(current_x, current_y);
    }
    ESP_LOGE(TAG, "Colour mode %u is not supported by the RGB driver", mode.val.u8);
    return ESP_ERR_NOT_SUPPORTED;
}

static esp_err_t apply_level_and_power(uint16_t endpoint_id)
{
    esp_matter_attr_val_t value = esp_matter_invalid(NULL);
    esp_err_t err = read_attribute(endpoint_id, LevelControl::Id, LevelControl::Attributes::CurrentLevel::Id, &value);
    if (err != ESP_OK) return err;
    err = rgb_led_set_brightness(value.val.u8);
    if (err != ESP_OK) return err;
    err = read_attribute(endpoint_id, OnOff::Id, OnOff::Attributes::OnOff::Id, &value);
    if (err != ESP_OK) return err;
    return rgb_led_set_power(value.val.b);
}

static esp_err_t rgb_attribute_update(callback_type_t type, uint16_t endpoint_id, uint32_t cluster_id,
                                      uint32_t attribute_id, esp_matter_attr_val_t *value, void *priv_data)
{
    (void)priv_data;
    if (!driver_ready || type != PRE_UPDATE || endpoint_id != light_endpoint_id || value == nullptr) {
        return ESP_OK;
    }
    if (cluster_id == OnOff::Id && attribute_id == OnOff::Attributes::OnOff::Id) {
        return rgb_led_set_power(value->val.b);
    }
    if (cluster_id == LevelControl::Id && attribute_id == LevelControl::Attributes::CurrentLevel::Id) {
        return rgb_led_set_brightness(value->val.u8);
    }
    if (cluster_id != ColorControl::Id) {
        return ESP_OK;
    }
    esp_matter_attr_val_t stored = esp_matter_invalid(NULL);
    if (attribute_id == ColorControl::Attributes::CurrentHue::Id) {
        if (read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentSaturation::Id, &stored) != ESP_OK) {
            return ESP_ERR_NOT_FOUND;
        }
        return rgb_led_set_hsv(value->val.u8, stored.val.u8);
    }
    if (attribute_id == ColorControl::Attributes::CurrentSaturation::Id) {
        if (read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentHue::Id, &stored) != ESP_OK) {
            return ESP_ERR_NOT_FOUND;
        }
        return rgb_led_set_hsv(stored.val.u8, value->val.u8);
    }
    if (attribute_id == ColorControl::Attributes::ColorTemperatureMireds::Id) {
        return rgb_led_set_color_temperature(value->val.u16);
    }
    if (attribute_id == ColorControl::Attributes::CurrentX::Id) {
        if (read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentY::Id, &stored) != ESP_OK) {
            return ESP_ERR_NOT_FOUND;
        }
        current_x = value->val.u16;
        current_y = stored.val.u16;
        return rgb_led_set_xy(current_x, current_y);
    }
    if (attribute_id == ColorControl::Attributes::CurrentY::Id) {
        if (read_attribute(endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentX::Id, &stored) != ESP_OK) {
            return ESP_ERR_NOT_FOUND;
        }
        current_x = stored.val.u16;
        current_y = value->val.u16;
        return rgb_led_set_xy(current_x, current_y);
    }
    return ESP_OK;
}

static void retain_changing_attribute(uint16_t endpoint_id, uint32_t cluster_id, uint32_t attribute_id)
{
    attribute_t *attribute = attribute::get(endpoint_id, cluster_id, attribute_id);
    if (attribute != nullptr) {
        attribute::set_deferred_persistence(attribute);
    }
}

esp_err_t iotedu_rgb_register(esp_matter::node_t *node)
{
    if (node == nullptr) {
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = attribute::set_callback(rgb_attribute_update);
    if (err != ESP_OK) {
        return err;
    }

    extended_color_light::config_t config;
    config.color_control.color_mode = static_cast<uint8_t>(ColorControl::ColorMode::kCurrentHueAndCurrentSaturation);
    config.color_control.enhanced_color_mode = static_cast<uint8_t>(ColorControl::ColorMode::kCurrentHueAndCurrentSaturation);
    endpoint_t *endpoint = extended_color_light::create(node, &config, ENDPOINT_FLAG_NONE, NULL);
    if (endpoint == nullptr) {
        ESP_LOGE(TAG, "Failed to create the extended colour light endpoint");
        return ESP_FAIL;
    }
    cluster_t *color_cluster = esp_matter::cluster::get(endpoint, ColorControl::Id);
    if (color_cluster == nullptr) {
        ESP_LOGE(TAG, "Color Control cluster was not created on the extended colour light");
        return ESP_ERR_NOT_FOUND;
    }
    esp_matter::cluster::color_control::feature::hue_saturation::config_t hue_saturation;
    err = esp_matter::cluster::color_control::feature::hue_saturation::add(color_cluster, &hue_saturation);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "hue_saturation::add failed: %s (%d). CurrentHue and CurrentSaturation are not created by XY or colour-temperature features.",
                 esp_err_to_name(err), err);
        return err;
    }
    light_endpoint_id = endpoint::get_id(endpoint);
    retain_changing_attribute(light_endpoint_id, LevelControl::Id, LevelControl::Attributes::CurrentLevel::Id);
    retain_changing_attribute(light_endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentHue::Id);
    retain_changing_attribute(light_endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentSaturation::Id);
    retain_changing_attribute(light_endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentX::Id);
    retain_changing_attribute(light_endpoint_id, ColorControl::Id, ColorControl::Attributes::CurrentY::Id);
    retain_changing_attribute(light_endpoint_id, ColorControl::Id, ColorControl::Attributes::ColorTemperatureMireds::Id);

    const gpio_num_t red = static_cast<gpio_num_t>(CONFIG_IOTEDU_RGB_RED_GPIO);
    const gpio_num_t green = static_cast<gpio_num_t>(CONFIG_IOTEDU_RGB_GREEN_GPIO);
    const gpio_num_t blue = static_cast<gpio_num_t>(CONFIG_IOTEDU_RGB_BLUE_GPIO);
    ESP_LOGI(TAG, "Extended colour light endpoint %u on red GPIO%d, green GPIO%d, blue GPIO%d",
             light_endpoint_id, static_cast<int>(red), static_cast<int>(green), static_cast<int>(blue));
    err = rgb_led_init(red, green, blue);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "rgb_led_init failed: %s (%d). Matter was not started.", esp_err_to_name(err), err);
        return err;
    }
    driver_ready = true;
    err = apply_colour(light_endpoint_id);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "apply_colour failed: %s (%d). The LED driver result is separate from this attribute read.", esp_err_to_name(err), err);
        return err;
    }
    err = apply_level_and_power(light_endpoint_id);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "apply_level_and_power failed: %s (%d)", esp_err_to_name(err), err);
    }
    return err;
}
