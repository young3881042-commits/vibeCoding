package com.platform.jupiter.localtrip;

import java.time.Instant;
import java.util.List;

public record TravelPlanResponse(
        Long id,
        String title,
        String region,
        List<String> styles,
        Integer days,
        Integer travelerCount,
        String travelerType,
        String pace,
        String summary,
        Instant createdAt,
        Instant updatedAt,
        List<TravelPlanItemResponse> items) {
    public static TravelPlanResponse from(TravelPlan plan, List<TravelPlanItem> items) {
        return new TravelPlanResponse(
                plan.getId(),
                plan.getTitle(),
                plan.getRegion(),
                LocalTripText.splitCsv(plan.getStyles()),
                plan.getDays(),
                plan.getTravelerCount(),
                plan.getTravelerType(),
                plan.getPace(),
                plan.getSummary(),
                plan.getCreatedAt(),
                plan.getUpdatedAt(),
                items.stream().map(TravelPlanItemResponse::from).toList());
    }
}
