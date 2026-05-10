package com.platform.jupiter.localtrip;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.platform.jupiter.chat.ChatCredentialService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
    private final ChatCredentialService chatCredentialService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public TravelPlanService(
            TravelPlanRepository travelPlanRepository,
            TravelPlanItemRepository travelPlanItemRepository,
            LocalTripDestinationService destinationService,
            LocalTripSchemaService schemaService,
            ChatCredentialService chatCredentialService,
            ObjectMapper objectMapper) {
        this.travelPlanRepository = travelPlanRepository;
        this.travelPlanItemRepository = travelPlanItemRepository;
        this.destinationService = destinationService;
        this.schemaService = schemaService;
        this.chatCredentialService = chatCredentialService;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(20))
                .build();
    }

    @Transactional
    public TravelPlanResponse generate(TravelPlanGenerateRequest request) {
        schemaService.ensureSchema();
        int days = request.days() == null ? 2 : request.days();
        String travelerType = defaultText(request.travelerType(), "커플");
        String pace = defaultText(request.pace(), "보통");
        List<String> regions = normalizeRegions(request);
        List<String> styles = normalizeStyles(request);
        
        String regionLabel = regions.isEmpty() ? "전국" : String.join("·", regions);
        String stylesLabel = styles.isEmpty() ? "추천" : String.join(",", styles);

        // Plan metadata saving
        TravelPlan plan = new TravelPlan();
        plan.setTitle(regionLabel + " " + days + "일 LocalTrip AI 일정");
        plan.setRegion(regionLabel);
        plan.setStyles(stylesLabel);
        plan.setDays(days);
        plan.setTravelerType(travelerType);
        plan.setPace(pace);
        plan.setSummary(regionLabel + "의 " + stylesLabel + " 취향을 반영한 " + travelerType + "용 "
                + pace + " 속도 추천 일정입니다.");
        TravelPlan savedPlan = travelPlanRepository.save(plan);

        // Call Gemini for real itinerary
        List<TravelPlanItem> items = generateItineraryWithGemini(savedPlan, request);
        travelPlanItemRepository.saveAll(items);

        return TravelPlanResponse.from(savedPlan, travelPlanItemRepository.findByTravelPlanIdOrderByDayNumberAscSequenceNumberAsc(savedPlan.getId()));
    }

    private List<TravelPlanItem> generateItineraryWithGemini(TravelPlan plan, TravelPlanGenerateRequest request) {
        String prompt = buildPrompt(plan, request);
        try {
            String token = chatCredentialService.resolveGeminiAuthorization("admin")
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Gemini API key is not configured. Please set APP_GEMINI_API_KEY in .env"));

            Map<String, Object> payload = Map.of(
                "model", "gemini-2.0-flash",
                "messages", List.of(
                    Map.of("role", "system", "content", "너는 한국 전문 여행 가이드 AI다. 반드시 요청받은 JSON 형식으로만 답변하고 다른 설명은 하지 마라."),
                    Map.of("role", "user", "content", prompt)
                )
            );

            HttpRequest httpRequest = HttpRequest.newBuilder()
                    .uri(URI.create("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"))
                    .timeout(Duration.ofSeconds(120))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + token)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) {
                throw new RuntimeException("Gemini API call failed with status " + response.statusCode());
            }

            JsonNode root = objectMapper.readTree(response.body());
            String content = root.path("choices").path(0).path("message").path("content").asText("");
            
            // Extract JSON block if present
            if (content.contains("```json")) {
                content = content.substring(content.indexOf("```json") + 7);
                content = content.substring(0, content.lastIndexOf("```"));
            } else if (content.contains("```")) {
                content = content.substring(content.indexOf("```") + 3);
                content = content.substring(0, content.lastIndexOf("```"));
            }

            JsonNode itineraryNode = objectMapper.readTree(content);
            List<TravelPlanItem> items = new ArrayList<>();
            
            if (itineraryNode.isArray()) {
                for (JsonNode node : itineraryNode) {
                    items.add(parseItem(plan.getId(), node));
                }
            } else if (itineraryNode.has("itinerary")) {
                for (JsonNode node : itineraryNode.get("itinerary")) {
                    items.add(parseItem(plan.getId(), node));
                }
            }
            return items;

        } catch (Exception e) {
            // Fallback to basic generation if Gemini fails
            return fallbackItems(plan);
        }
    }

    private String buildPrompt(TravelPlan plan, TravelPlanGenerateRequest request) {
        return String.format(
            "다음 조건에 맞춰서 한국 여행 일정을 짜줘.\n" +
            "- 지역: %s\n" +
            "- 기간: %d일\n" +
            "- 동행: %s\n" +
            "- 선호: %s\n" +
            "- 속도: %s\n\n" +
            "응답은 반드시 다음 JSON 형식을 포함하는 배열이어야 해:\n" +
            "[{\"dayNumber\": 1, \"timeSlot\": \"오전\", \"destinationName\": \"장소명\", \"note\": \"설명\", \"primaryStyle\": \"테마\"}, ...]\n" +
            "각 날짜마다 오전, 점심, 오후 최소 3개의 일정을 포함해줘.",
            plan.getRegion(), plan.getDays(), plan.getTravelerType(), plan.getStyles(), plan.getPace()
        );
    }

    private TravelPlanItem parseItem(Long planId, JsonNode node) {
        TravelPlanItem item = new TravelPlanItem();
        item.setTravelPlanId(planId);
        item.setDayNumber(node.path("dayNumber").asInt(1));
        item.setSequenceNumber(node.path("sequenceNumber").asInt(0));
        item.setTimeSlot(node.path("timeSlot").asText("유동적"));
        item.setDestinationName(node.path("destinationName").asText("미정"));
        item.setNote(node.path("note").asText(""));
        item.setPrimaryStyle(node.path("primaryStyle").asText("관광"));
        item.setDurationMinutes(60);
        return item;
    }

    private List<TravelPlanItem> fallbackItems(TravelPlan plan) {
        List<TravelPlanItem> items = new ArrayList<>();
        for (int day = 1; day <= plan.getDays(); day++) {
            TravelPlanItem item = new TravelPlanItem();
            item.setTravelPlanId(plan.getId());
            item.setDayNumber(day);
            item.setTimeSlot("종일");
            item.setDestinationName(plan.getRegion() + " 자유 여행");
            item.setNote("Gemini 일정 생성에 일시적인 문제가 있어 기본 정보만 제공합니다.");
            item.setPrimaryStyle("자유");
            items.add(item);
        }
        return items;
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
