#pragma once

#include <esp_err.h>
#include <esp_matter.h>

// Creates one extended-colour-light endpoint and connects its attribute updates to the RGB driver.
esp_err_t iotedu_rgb_register(esp_matter::node_t *node);
