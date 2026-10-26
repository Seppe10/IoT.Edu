#pragma once

#include <stdbool.h>
#include <stdint.h>

// Matter TemperatureMeasurement values are signed 0.01°C units.
// Matter RelativeHumidityMeasurement values are unsigned 0.01% RH units.
// The DHT11 operating range is 0–50°C and 20–90% RH.
#define IOTEDU_DHT11_TEMP_MIN_C 0
#define IOTEDU_DHT11_TEMP_MAX_C 50
#define IOTEDU_DHT11_TEMP_MIN_CENTI 0
#define IOTEDU_DHT11_TEMP_MAX_CENTI 5000
#define IOTEDU_DHT11_HUMIDITY_MIN_PERCENT 20
#define IOTEDU_DHT11_HUMIDITY_MAX_PERCENT 90
#define IOTEDU_DHT11_HUMIDITY_MIN_CENTI 2000
#define IOTEDU_DHT11_HUMIDITY_MAX_CENTI 9000

static inline bool iotedu_dht11_temperature_acceptable(int celsius)
{
    return celsius >= IOTEDU_DHT11_TEMP_MIN_C && celsius <= IOTEDU_DHT11_TEMP_MAX_C;
}

static inline bool iotedu_dht11_humidity_acceptable(int percent)
{
    return percent >= IOTEDU_DHT11_HUMIDITY_MIN_PERCENT && percent <= IOTEDU_DHT11_HUMIDITY_MAX_PERCENT;
}
