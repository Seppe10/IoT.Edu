#pragma once

#include <esp_err.h>
#include <esp_matter.h>

// Creates the temperature and humidity endpoints and starts the DHT11 poll task.
// The data GPIO comes from CONFIG_IOTEDU_DHT11_PIN (default 4).
esp_err_t iotedu_dht11_register(esp_matter::node_t *node);
