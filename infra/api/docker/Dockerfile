FROM gradle:8.8-jdk17 AS build
WORKDIR /app
COPY apps/api /app
RUN if [ -x ./gradlew ]; then ./gradlew bootJar --no-daemon; else gradle bootJar --no-daemon; fi

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
