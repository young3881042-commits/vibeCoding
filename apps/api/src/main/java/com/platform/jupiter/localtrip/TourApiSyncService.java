package com.platform.jupiter.localtrip;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TourApiSyncService {
    private final TourApiProperties properties;
    private final TourApiService tourApiService;
    private final ApiSyncLogRepository syncLogRepository;
    private final LocalTripSchemaService schemaService;

    public TourApiSyncService(
            TourApiProperties properties,
            TourApiService tourApiService,
            ApiSyncLogRepository syncLogRepository,
            LocalTripSchemaService schemaService) {
        this.properties = properties;
        this.tourApiService = tourApiService;
        this.syncLogRepository = syncLogRepository;
        this.schemaService = schemaService;
    }

    @Transactional
    public ApiSyncLogResponse syncDestinations() {
        schemaService.ensureSchema();
        Instant startedAt = Instant.now();
        ApiSyncLog log = new ApiSyncLog();
        log.setProvider("tour-api");
        log.setSyncType("DESTINATION");
        log.setRecordsInserted(0);
        log.setRecordsUpdated(0);
        log.setRequestUrl(properties.baseUrlOrDefault());
        log.setStartedAt(startedAt);

        if (!properties.hasServiceKey()) {
            log.setStatus("SKIPPED");
            log.setMessage("Tour API service key is not configured; external sync skipped.");
            log.setEndedAt(Instant.now());
            return ApiSyncLogResponse.from(syncLogRepository.save(log));
        }

        try {
            List<TourApiDestination> destinations = tourApiService.fetchDestinations();
            log.setStatus("SUCCEEDED");
            log.setMessage("Tour API sync scaffold completed with " + destinations.size() + " parsed records.");
        } catch (RuntimeException exception) {
            log.setStatus("FAILED");
            log.setMessage("Tour API sync failed.");
            log.setErrorDetail(stackTrace(exception));
        }

        log.setEndedAt(Instant.now());
        return ApiSyncLogResponse.from(syncLogRepository.save(log));
    }

    private String stackTrace(RuntimeException exception) {
        StringWriter writer = new StringWriter();
        exception.printStackTrace(new PrintWriter(writer));
        return writer.toString();
    }
}
