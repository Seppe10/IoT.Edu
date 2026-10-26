#pragma once

#include <esp_err.h>
#include <esp_matter.h>

// Registers the DHT11 temperature and humidity endpoints on the node created by iotedu_core_prepare.
esp_err_t iotedu_dht11_register(esp_matter::node_t *node);
