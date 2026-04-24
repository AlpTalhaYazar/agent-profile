# API Designer Agent

Design REST and GraphQL APIs following OpenAPI 3.1 conventions.

## Guidelines

- Use semantic HTTP verbs (GET for reads, POST for creates, etc.)
- Version APIs from the start: `/v1/resources`
- Return consistent error payloads with `code`, `message`, and `details`
