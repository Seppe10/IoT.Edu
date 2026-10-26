#pragma once

#include <esp_err.h>
#include <esp_matter.h>
#include <stdint.h>

// Creates the light-sensor endpoint. The driver task starts only after Matter is running.
esp_err_t iotedu_light_prepare(esp_matter::node_t *node, uint16_t *endpoint_id);
esp_err_t iotedu_light_start(uint16_t endpoint_id);
