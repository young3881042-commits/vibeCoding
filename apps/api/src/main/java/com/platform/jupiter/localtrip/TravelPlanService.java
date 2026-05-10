package com.platform.jupiter.localtrip;

import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TravelPlanService {
    private static final List<String> TIME_SLOTS = List.of("오전", "점심", "오후");

    private final TravelPlanRepository travelPlanRepository;
    private final TravelPlanItemRepository travelPlanItemRepository;
    private final LocalTripDestinationService destinationService;
    private final LocalTripSchemaService schemaService;

    public TravelPlanService(
            TravelPlanRepository travelPlanRepository,
            TravelPlanItemRepository travelPlanItemRepository,
            LocalTripDestinationService destinationService,
            LocalTripSchemaService schemaService) {
        this.travelPlanRepository = travelPlanRepository;
        this.travelPlanItemRepository = travelPlanItemRepository;
        this.destinationService = destinationService;
        this.schemaService = schemaService;
    }

    @Transactional
    public TravelPlanResponse generate(TravelPlanGenerateRequest request) {
        schemaService.ensureSchema();
        int days = request.days() == null ? 2 : request.days();
        int travelerCount = request.travelerCount() == null ? 2 : request.travelerCount();
        String travelerType = defaultText(request.travelerType(), "커플");
        String transportType = defaultText(request.transportType(), "대중교통");
        String budgetLevel = defaultText(request.budgetLevel(), "보통");
        String pace = defaultText(request.pace(), "보통");
        List<String> regions = normalizeRegions(request);
        List<String> styles = normalizeStyles(request);
        String regionLabel = regions.isEmpty() ? "전국" : String.join("·", regions);
        String stylesLabel = styles.isEmpty() ? "추천" : String.join(",", styles);

        List<Destination> candidates = destinationService.findCandidates(regions, styles);
        if (candidates.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No destinations are available for itinerary generation.");
        }

        TravelPlan plan = new TravelPlan();
        plan.setTitle(regionLabel + " " + days + "일 LocalTrip AI 일정");
        plan.setRegion(regionLabel);
        plan.setStyles(stylesLabel);
        plan.setDays(days);
        plan.setTravelerCount(travelerCount);
        plan.setTravelerType(travelerType);
        plan.setPace(pace);
        plan.setSummary(regionLabel + "의 " + stylesLabel + " 취향을 반영한 " + travelerType + "용 "
                + pace + " 속도 추천 일정입니다. 이동수단은 " + transportType + ", 예산은 " + budgetLevel + " 기준입니다.");
        TravelPlan savedPlan = travelPlanRepository.save(plan);

        List<TravelPlanItem> items = new ArrayList<>();
        for (int day = 1; day <= days; day++) {
            for (int sequence = 1; sequence <= TIME_SLOTS.size(); sequence++) {
                Destination destination = candidates.get(((day - 1) * TIME_SLOTS.size() + sequence - 1) % candidates.size());
                items.add(createItem(savedPlan.getId(), day, sequence, destination));
            }
        }
        travelPlanItemRepository.saveAll(items);
        return TravelPlanResponse.from(savedPlan, travelPlanItemRepository.findByTravelPlanIdOrderByDayNumberAscSequenceNumberAsc(savedPlan.getId()));
    }

    @Transactional
    public List<TravelPlanResponse> listPlans() {
        schemaService.ensureSchema();
        return travelPlanRepository.findAllByOrderByCreatedAtDesc().stream()
                .map(plan -> TravelPlanResponse.from(plan, travelPlanItemRepository.findByTravelPlanIdOrderByDayNumberAscSequenceNumberAsc(plan.getId())))
                .toList();
    }

    @Transactional
    public TravelPlanResponse getPlan(Long id) {
        schemaService.ensureSchema();
        TravelPlan plan = travelPlanRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Travel plan not found"));
        return TravelPlanResponse.from(plan, travelPlanItemRepository.findByTravelPlanIdOrderByDayNumberAscSequenceNumberAsc(id));
    }

    @Transactional
    public void deletePlan(Long id) {
        schemaService.ensureSchema();
        if (!travelPlanRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Travel plan not found");
        }
        travelPlanItemRepository.deleteByTravelPlanId(id);
        travelPlanRepository.deleteById(id);
    }

    private TravelPlanItem createItem(Long travelPlanId, int day, int sequence, Destination destination) {
        TravelPlanItem item = new TravelPlanItem();
        item.setTravelPlanId(travelPlanId);
        item.setDestinationId(destination.getId());
        item.setDayNumber(day);
        item.setSequenceNumber(sequence);
        item.setTimeSlot(TIME_SLOTS.get(sequence - 1));
        item.setDestinationName(destination.getName());
        item.setRegion(destination.getRegion());
        item.setPrimaryStyle(destination.getPrimaryStyle());
        item.setDurationMinutes(destination.getRecommendedMinutes());
        item.setNote(destination.getHeadline());
        return item;
    }

    private List<String> normalizeRegions(TravelPlanGenerateRequest request) {
        List<String> regions = normalizeList(request.regions());
        String singleRegion = LocalTripText.normalize(request.region());
        if (!singleRegion.isBlank() && regions.stream().noneMatch(singleRegion::equalsIgnoreCase)) {
            List<String> merged = new ArrayList<>(regions);
            merged.add(singleRegion);
            return merged;
        }
        return regions;
    }

    private List<String> normalizeStyles(TravelPlanGenerateRequest request) {
        List<String> styles = normalizeList(request.styles());
        List<String> travelStyles = normalizeList(request.travelStyle());
        if (!travelStyles.isEmpty()) {
            styles = new ArrayList<>(styles);
            for (String travelStyle : travelStyles) {
                if (styles.stream().noneMatch(travelStyle::equalsIgnoreCase)) {
                    styles.add(travelStyle);
                }
            }
        }
        String singleStyle = LocalTripText.normalize(request.style());
        if (!singleStyle.isBlank() && styles.stream().noneMatch(singleStyle::equalsIgnoreCase)) {
            List<String> merged = new ArrayList<>(styles);
            merged.add(singleStyle);
            return merged;
        }
        return styles;
    }

    private List<String> normalizeList(List<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream()
                .map(LocalTripText::normalize)
                .filter(value -> !value.isBlank())
                .distinct()
                .toList();
    }

    private String defaultText(String value, String fallback) {
        String normalized = LocalTripText.normalize(value);
        return normalized.isBlank() ? fallback : normalized;
    }
}
