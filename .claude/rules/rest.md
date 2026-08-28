---
paths:
  - "**/class-rest-api.php"
---

# REST

- Namespace `post-voice/v1`, sempre (ADR-0007).
- Todo valor que o endpoint aceita é validado no servidor **mesmo quando a UI já o restringe**: um controle desabilitado é UX, não garantia (ADR-0007).
- O `source_hash` chega pronto do cliente; o servidor guarda e compara, nunca recalcula (ADR-0008).
