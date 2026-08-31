# MODULE PROMPTS — 필요한 조각만 뽑아 쓰는 프롬프트 8종

마스터 프롬프트가 너무 무거울 때, 또는 마스터 실행 후 특정 파트를 깊게 팔 때 씁니다.
각 모듈은 **마스터 프롬프트를 먼저 실행한 대화창**에 이어 붙이면 맥락을 그대로 물려받습니다.

---

## M1. Workspace Score 산식 설계 (시뮬레이터의 심장)

```text
Design the Workspace Score in full engineering detail.
Five subscores: Posture & Ergonomics, Focus & Acoustics, Light & Eye Strain, Motion & Energy, Signal.
For each: the input questions (max 7 total across all five), the answer-to-points mapping, the
weight, and the formula. Then:
  - Show the score for 5 worked examples: kitchen-table laptop worker; $200 Amazon desk + gaming
    chair; decent desk + bad chair; near-optimal setup; a 6-person startup bay.
  - Derive "focused hours lost per week" from the score gap. Name every assumption, cite the class
    of ergonomics/productivity research each rests on, and mark anything not directly supported
    as [ASSUMPTION].
  - Define the honest-downgrade rule: when a swap lowers a subscore, what exactly do we say.
  - Guarantee no score exceeds 72 without an adjustable-height work surface AND an adjustable
    chair — but show that this falls out of the weights, not a hardcoded clamp.
Output: a spec a backend engineer can implement without asking a question, plus the JSON schema
for the score payload.
```

## M2. 번들·가격 아키텍처 (AOV 엔진)

```text
Build the bundle and pricing architecture.
For each of the 5 room templates, define ESSENTIAL / RECOMMENDED / FLAGSHIP bundles: SKUs, list
price, bundle price, bundle discount %, blended gross margin, and the one-line reason each bundle
exists. Constraints: RECOMMENDED must land 1.9-2.3× ESSENTIAL; every bundle discount must be real
arithmetic off real component prices; blended margin never below {{42}}%.
Then: (a) solve for the optimal free-shipping threshold given the AOV distribution I gave you,
and list the 6 "threshold-clearing" accessories priced to bridge the most common gaps; (b) build
the accessory attach decision tree keyed to the weakest remaining subscore, with the exact
recommendation copy and its stated reason; (c) model the AOV impact of each in a table with
low/base/high scenarios.
```

## M3. 카피 덱 (구매 유혹의 언어)

```text
Write the complete copy deck for all 8 screens plus cart, PDP, and the 3 abandonment emails.
Follow the copy_system rules exactly. For every headline give 3 variants labeled by awareness
stage. For each of the 6 core objections write the pre-emption line and name where it appears.
Add: 12 subject lines for the abandonment sequence with predicted open-rate rationale, and the
share-card copy for the saved build (this gets posted to LinkedIn — write it so a product manager
is proud to post it).
Banned words are banned. Every claim carries its mechanism. No exclamation points.
```

## M4. B2B 견적 플로우 (객단가 10-40배 구간)

```text
Design the team/B2B motion end to end.
Quantity tiers (5/10/25/50/100+ seats) with discount %, margin at each tier, and the approval
threshold above which a human must sign off. The quote PDF layout, field by field. Net-30
application fields and the credit-decision rule. Sales-tax exemption certificate upload and
validation. White-glove install and old-furniture-haul-away as paid attach lines with their
margins. The lead-routing rule: what score/seat-count/company-size combination triggers an
immediate calendar link versus a nurture sequence. The 5-email nurture for office managers who
requested a quote and went quiet, written to their actual fear: being blamed for a bad purchase.
```

## M5. 3D/AR 기술 스펙

```text
Specify the 3D/AR implementation. React + React Three Fiber for the room builder; <model-viewer>
with USDZ (iOS Quick Look) and glTF/GLB (Android Scene Viewer) for AR — no app install, ever.
Cover: asset pipeline and poly/texture budgets for a <2s mobile load over LTE; Draco/KTX2
compression targets; the LOD strategy; a progressive path where the room is usable before the
high-res models land; occlusion and floor-plane placement quality bar; the deterministic
re-score-on-swap loop under 200ms; state serialization into a shareable build URL and its
back-end record; the server-side render of the build to an image for emails and share cards; and
the complete non-3D fallback path (plain HTML, keyboard, screen reader) that reaches the same
cart. Give the acceptance criteria and the device/browser test matrix.
```

## M6. 계측 & A/B 테스트 백로그

```text
Produce the measurement plan. Event schema as a table: event name, trigger, properties, and which
north-star metric it feeds. Define the funnel from entry to purchase with the expected drop-off at
each step and the diagnostic for each drop. Then give a ranked backlog of 12 A/B tests — for each:
hypothesis in "if/then/because" form, primary metric, guardrail metric, MDE, required sample size
at our traffic, estimated runtime, and build cost. Rank by (expected lift × confidence) ÷ cost.
Flag any test that cannot reach significance at our traffic within 6 weeks and propose what to do
instead (sequential testing, holdout cohorts, or ship-on-judgment).
```

## M7. 컴플라이언스 감사 (출시 전 필수)

```text
Audit the full design you just produced against US requirements and return a table of
issue / severity / where it appears / the specific fix:
FTC Section 5 deception and dark patterns; the FTC rule on unfair or deceptive fees (drip
pricing, mandatory-fee disclosure); the Negative Option / click-to-cancel rule; endorsement and
testimonial rules including incentivized reviews and the review-suppression prohibition; pricing
and reference-price ("was/now") substantiation; CAN-SPAM for every email; TCPA written consent for
any SMS; CCPA/CPRA notice, opt-out, and Global Privacy Control; ADA/WCAG 2.2 AA for the 3D and AR
flows; Prop 65 warnings where applicable to the products; and California Automatic Renewal Law if
anything recurs. For each issue give the exact compliant replacement copy or mechanic — do not
just flag it. Then list what must be reviewed by actual counsel before launch.
```

## M8. 1주 v0 (3D 없이 핵심 가설만 검증)

```text
Strip the concept to a 1-week v0 that tests only the core hypothesis: "a quantified workspace gap
plus an ROI close converts materially better than a product grid." No 3D, no AR. Specify: the 7
questions, the score reveal, the three bundles as photography, the ROI close, the email capture,
and the checkout hand-off. Give the page structure, the copy, the event schema, the success
criterion with its sample size, and the exact kill/scale decision rule. Then list, in order, what
gets built in weeks 2-6 only if v0 clears the bar.
```
