#pragma once

#include <esp_err.h>
#include <esp_matter.h>
#include <stdint.h>

// Leaves a previously used dynamic endpoint id unused so a new function is not created on it.
// Endpoint 0 is the root and is never reserved here.
esp_err_t iotedu_composition_reserve(esp_matter::node_t *node, uint16_t endpoint_id);
