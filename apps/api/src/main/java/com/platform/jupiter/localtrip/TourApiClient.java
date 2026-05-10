package com.platform.jupiter.localtrip;

import java.net.URI;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class TourApiClient {
    private final TourApiProperties properties;
    private final RestClient restClient;

    public TourApiClient(TourApiProperties properties) {
        this.properties = properties;
        this.restClient = RestClient.builder().build();
    }

    public List<TourApiDestination> fetchAreaBasedDestinations() {
        if (!properties.hasServiceKey()) {
            return List.of();
        }
        URI uri = UriComponentsBuilder.fromHttpUrl(properties.baseUrlOrDefault())
                .path("/areaBasedList2")
                .queryParam("MobileOS", "ETC")
                .queryParam("MobileApp", "JupiterLocalTrip")
                .queryParam("_type", "json")
                .queryParam("numOfRows", 20)
                .queryParam("pageNo", 1)
                .queryParam("serviceKey", properties.serviceKey())
                .build(true)
                .toUri();

        restClient.get()
                .uri(uri)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .body(String.class);
        return List.of();
    }
}
