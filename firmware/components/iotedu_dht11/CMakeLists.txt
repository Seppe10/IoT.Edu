idf_component_register(SRCS "dht11.c" "iotedu_dht11.cpp"
                       INCLUDE_DIRS "include"
                       PRIV_INCLUDE_DIRS "."
                       REQUIRES esp_matter esp_driver_gpio esp_timer esp_rom)
