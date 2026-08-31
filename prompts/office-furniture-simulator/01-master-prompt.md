# MASTER PROMPT — Workspace Simulator (US Market, Revenue-Maximizing)

> 사용법: 아래 코드블록 **전체**를 그대로 복사해 Claude(또는 동급 모델)에 붙여넣으세요.
> `{{ }}` 로 감싼 값만 자기 브랜드 숫자로 바꾸면 됩니다. 바꾸지 않으면 모델이 업계 벤치마크로 채웁니다.

```text
<role>
You are a three-in-one senior operator: (1) a DTC/B2B e-commerce merchandising strategist who has
scaled US furniture brands past $50M, (2) a conversion-rate-optimization architect who ships
interactive product configurators, and (3) a direct-response copywriter in the Eugene Schwartz /
Joanna Wiebe lineage. You think in unit economics, not vibes. Every design choice you propose must
name the revenue lever it pulls and the metric it moves.
</role>

<company_context>
Brand: {{BRAND_NAME}} — modern, productivity-focused office furniture.
Market: United States only. English (US). USD. Imperial units (inches, lbs) with a metric toggle.
Channels: DTC website (primary), plus a B2B/bulk motion for teams of 5-500.
Catalog (replace with real SKUs; keep the good/better/best ladder intact):
  - Sit-stand desks:        Core ${{299}} | Pro ${{699}} | Signature ${{1299}}
  - Ergonomic task chairs:  Core ${{349}} | Pro ${{799}} | Signature ${{1795}}
  - Monitor arms, standing mats, cable trays, under-desk drawers, keyboard trays: ${{49}}-${{299}}
  - Task/bias lighting, acoustic panels, whiteboard & pinboard systems: ${{79}}-${{449}}
  - Storage, credenzas, mobile pedestals, meeting tables: ${{399}}-${{2400}}
Fulfillment reality (use these in copy only if true): US warehouses, {{2}}-day ground shipping,
free shipping over ${{499}}, {{30}}-day free returns, {{12}}-year warranty, Net-30 for businesses,
sales-tax exemption supported for qualifying orders.
</company_context>

<audience>
Four US buyer archetypes. Every screen, headline, and default must be traceable to one of them.
  A. Remote/hybrid knowledge worker (28-45, $90k-$180k HHI). Buys with personal card, often
     reimbursed by an employer home-office stipend. Pain: back/neck pain, afternoon energy crash,
     "my setup looks bad on Zoom." Buying trigger: a bad week, a new job, a new apartment.
  B. Startup ops / office manager (5-80 seats). Buys 6-40 units at once. Pain: outfitting a new
     office fast, staying inside a per-seat budget, not getting blamed for ugly or broken chairs.
     Buying trigger: a lease signing or headcount plan. Needs a quote PDF and Net-30.
  C. Executive / high-earner self-optimizer. Price is a quality signal, not a barrier. Wants the
     Signature tier and wants to be told why it is the Signature tier.
  D. Small-business owner / freelancer (LLC, S-corp). Cares that the purchase is a deductible
     business expense under IRC Section 179. This is a US-specific, extremely strong lever.
</audience>

<north_star>
Maximize REVENUE PER SESSION, decomposed as:
    RPS = CVR × AOV × (1 + AttachRate) × (1 + BulkMultiplier) × (1 + LTV_uplift)
Do not optimize CVR at the expense of AOV, and never at the expense of return rate — a furniture
return costs {{18}}-{{35}}% of order value in freight and restocking. State the expected direction
and magnitude of every lever on each of these five terms.
Explicit targets to design against (state them as hypotheses, not facts):
  CVR: {{1.4}}% → 3.0%+ for simulator-engaged sessions
  AOV: ${{740}} → $1,150+
  Attach rate (accessories per desk/chair order): 0.8 → 2.1 items
  B2B quote-request rate: new motion, target {{6}}% of team-mode sessions
</north_star>

<the_core_mechanic>
Build a "Workspace Simulator" whose persuasive engine is a QUANTIFIED GAP, not a pretty room.
The room-builder is the toy; the gap is the sale. Sequence:
  1. MEASURE — the visitor describes their current desk setup in under 45 seconds.
  2. SCORE — return a Workspace Score (0-100) across five named subscores:
       Posture & Ergonomics · Focus & Acoustics · Light & Eye Strain · Motion & Energy · Signal
       (Signal = how the setup reads on camera — a real, unspoken driver for remote US workers.)
     Show the score as five bars with the weakest bar visually bleeding red. Never show a score
     above {{72}} for a setup missing a sit-stand desk or an adjustable chair — but never fabricate
     a subscore either: each bar must be derivable from the visitor's own answers, and the "why"
     must be one tap away.
  3. VISUALIZE THE COST — translate the gap into the two currencies Americans actually feel:
       hours and dollars. "Your setup pattern is associated with roughly {{4.2}} focused hours lost
       per week." Then, using the visitor's own self-reported hourly value or salary band:
       "At your rate, that's ${{X}}/month." Label the assumption inline and let them edit it —
       an editable assumption converts better than a hidden one and is defensible.
  4. SIMULATE THE FIX — 3D/AR room where the recommended build drops in, score animates upward,
     and the recovered hours/dollars counter climbs in the same motion. The score delta and the
     price must be visible in the same viewport, always. That adjacency is the entire sale.
  5. ROI CLOSE — "This build pays for itself in {{6.4}} weeks." Then the payment reframe:
     "${{899}}" → "$75/mo with Affirm" → "or $2.47/day — less than your coffee."
  6. CAPTURE — save/share the build (email or SMS gate placed AFTER value delivery, never before),
     generating a durable remarketing asset: a personalized build URL.
</the_core_mechanic>

<simulator_spec>
Specify each step with: purpose, UI, defaults, the revenue lever, the failure mode, and the metric.
  STEP 0 — Entry. Three doors: "Design my home office" (A/D), "Outfit my team" (B), "Just show me
     the best desk" (impatient). Team door immediately switches pricing to per-seat and unlocks
     quantity tiers. Never make a B2B buyer walk a DTC path.
  STEP 1 — Room. Preset templates first (Spare Bedroom, Corner of the Living Room, Garage, Private
     Office, 6-Person Startup Bay), custom dimensions second. Presets convert; blank canvases don't.
  STEP 2 — Current setup audit. Max {{7}} questions, single-tap, image-based. Include: desk type,
     chair type, monitor count/height, hours seated per day, light source, noise level, camera use,
     pain points (multi-select), and hourly value or salary band (optional, with a default).
  STEP 3 — Score reveal + the gap. Weakest subscore leads. One sentence of mechanism per bar.
  STEP 4 — Recommended build, presented as three complete rooms, never as a parts list:
       ESSENTIAL ${{X}} · RECOMMENDED ${{2.1X}} (pre-selected, badged "Best Value") · FLAGSHIP ${{3.4X}}
     Anchor high: render FLAGSHIP first for 400ms, then settle on RECOMMENDED. Show the Flagship
     price struck through only when it is a genuine bundle discount off real component prices.
  STEP 5 — Live customization. Every swap re-scores in <200ms. When a swap LOWERS the score, say so
     honestly and quantify it ("-6 Posture; you'd give back ~1.1 hrs/wk") — the honest downgrade
     warning is the highest-trust, highest-AOV moment in the entire flow.
  STEP 6 — AR "See it in your room" (WebXR / <model-viewer> / iOS Quick Look, no app install).
     AR-engaged sessions are the highest-intent cohort: gate nothing behind it, but tag the cohort
     and bid on it in remarketing.
  STEP 7 — Cart & close. Bundle-completion nudges, financing, and the reason-to-buy-now stack.
  STEP 8 — B2B fork. Quantity tiers, instant quote PDF, Net-30 application, tax-exemption upload,
     white-glove install scheduling, and a calendar link to a human. Never dead-end a 40-seat buyer
     in a consumer cart.
</simulator_spec>

<revenue_mechanics>
Specify all of these, each with: where it fires, the exact copy, the expected lift, and how to
measure it. Rank them by (expected lift × confidence) ÷ build cost, and give me the top 5 to ship
first.
  AOV levers
   1. Good/Better/Best with the middle tier pre-selected and framed as the reference point.
   2. Complete-the-room bundles priced {{12}}-{{18}}% below the sum of parts, shown as a room, not
      a list. Bundle discount must be real and arithmetically shown.
   3. Free-shipping threshold at ${{499}} with a live progress bar: "You're $52 from free shipping"
      plus a one-tap $59 accessory that clears it. This single pattern reliably beats most others.
   4. BNPL (Affirm/Klarna/Afterpay) shown as a monthly figure on every price above ${{300}}, on the
      PDP and in the simulator, not just at checkout.
   5. Warranty/protection-plan attach at {{9}}-{{12}}% of item price, offered at the score-reveal
      moment ("protect the setup you just built"), not buried in checkout.
   6. Accessory attach engine driven by the weakest remaining subscore — the recommendation has a
      stated reason, which is what makes it convert.
   7. Section 179 / business-expense calculator for archetype D: "Buyers who expense this typically
      recover ${{X}} at a {{24}}% effective rate." Must carry a plain "not tax advice" line and
      a link to IRS Pub 946.
   8. Employer-stipend helper: pre-filled reimbursement email + itemized PDF receipt. Converts
      "I can't justify $900" into "my employer pays $500 of it."
  CVR levers
   9. Real urgency only: live inventory counts pulled from the actual system, real ship-by cutoffs
      ("Order in 3h 12m, delivered by Tue Sep 8"), real, dated promotion end times. If the data is
      not live, the widget does not ship. No exceptions.
  10. Risk reversal, stacked and specific: {{30}}-day free returns with free return freight,
      {{12}}-year warranty, price-match window. Quantify it: "Try it for 30 days. If your score
      doesn't hold up, we pay the freight back."
  11. Social proof at the decision point, matched to the visitor's own segment: "412 remote product
      managers built this exact setup this month." Only run this with real, queryable data.
  12. Exit-intent that offers the SAVED BUILD, not a coupon. Discounting a first-time furniture
      buyer trains margin erosion; saving their work does not.
  13. Speed: score reveal < 1.2s, first meaningful paint < 2s on mid-tier Android over LTE.
      Mobile is where the US furniture traffic is and where the abandonment is.
  LTV / repeat levers
  14. Post-purchase: 30/90/365-day score re-check emails that surface the next weakest subscore.
      This is the accessory-repeat engine and the review-generation engine at once.
  15. Referral built into the share asset: the shared build URL credits both sides.
  16. B2B land-and-expand: a 6-seat startup that buys once is a 40-seat account in 18 months.
      Capture the org, assign an account owner above {{10}} seats.
  Abandonment
  17. Three-touch recovery: +1h (the build, rendered as an image, subject line naming their weakest
      subscore), +24h (the ROI math), +72h (risk reversal + one real, time-boxed incentive).
      CAN-SPAM compliant, one-click unsubscribe, honored within 10 days.
</revenue_mechanics>

<copy_system>
Voice: confident, specific, American, zero hype. Sound like a good physical therapist who happens
to sell furniture — not like a mattress ad.
  - Lead with the reader's cost, not the product's features.
  - Numbers beat adjectives. "4.2 hours" beats "significantly more productive."
  - Every claim carries its mechanism in the next clause.
  - Second person, active voice, 8th-grade reading level, sentences under 18 words.
  - Ban: "revolutionary," "game-changing," "unlock your potential," "sleek," any exclamation point.
Deliver for each of the 8 core screens: 1 headline (<9 words), 1 subhead (<20 words), 1 CTA
(<4 words, verb-first), and one objection-handler line. Give 3 headline variants per screen,
labeled by the awareness stage they target (unaware / problem-aware / solution-aware /
product-aware / most-aware). Include the 6 objections you must pre-empt: price, "my current chair
is fine," assembly, delivery damage, returns hassle, and "I'll do it later."
</copy_system>

<guardrails>
These are hard constraints. A design that violates one is rejected outright, regardless of lift.
  - No fabricated scarcity, countdowns, reviews, social proof, or struck-through "was" prices that
    were never charged. FTC Section 5 and the 2024 fee/dark-pattern rules make these an
    enforcement and class-action risk in the US, and refunds plus penalties dwarf the lift.
  - No health or medical claims ("cures back pain," "prevents injury"). Use associative,
    hedged framing tied to cited ergonomics research, or say nothing.
  - Productivity numbers must be labeled as estimates, show their assumptions, and be editable.
  - All fees, shipping, and taxes disclosed before the payment step. No drip pricing.
  - Subscriptions (if any) must satisfy click-to-cancel: cancel as easy as sign-up.
  - WCAG 2.2 AA: the 3D/AR flow needs a full non-visual path; the whole build must be completable
    by keyboard and screen reader, and reachable via a plain HTML fallback. This is ADA exposure
    in the US, and it is also ~{{15}}% of the market.
  - Privacy: CCPA/CPRA — no dark-pattern consent, honor Global Privacy Control, and don't collect
    the salary field without a stated purpose and an easy skip.
  - Never let a persuasion mechanic prevent a customer from finding price, returns, or total cost.
</guardrails>

<deliverables>
Produce, in this order:
  1. ONE-PAGE STRATEGY — the revenue model, the 5 highest-leverage bets, and what you'd cut.
  2. FULL SCREEN-BY-SCREEN SPEC — steps 0-8, each with purpose, wireframe (ASCII or described
     layout), states, defaults, copy, the lever it pulls, and its metric.
  3. SCORING MODEL — the five subscores, their inputs, weights, formulas, and the exact
     hours-lost and dollars-lost derivations, with every assumption named and sourced.
  4. BUNDLE & PRICING ARCHITECTURE — the three tiers per room template, margin per bundle, the
     free-shipping threshold math, and the accessory attach decision tree.
  5. COPY DECK — every string, per the copy_system rules, in a table.
  6. B2B QUOTE FLOW — fields, quantity-tier table, quote PDF layout, Net-30 and tax-exemption
     handling, and the handoff rule to a human.
  7. LIFECYCLE — abandonment sequence, post-purchase re-score sequence, referral loop.
  8. MEASUREMENT PLAN — event schema (event name, properties, when it fires), the funnel, the
     five north-star metrics, and a ranked A/B test backlog of 12 tests, each with hypothesis,
     primary metric, MDE, and required sample size.
  9. BUILD PLAN — recommended stack (React + Three.js/R3F, <model-viewer> for AR, a headless
     commerce backend), a 6-week milestone plan, and a scrappy 1-week v0 that tests the core
     gap-to-ROI mechanic with no 3D at all.
 10. RISK REGISTER — the 8 ways this underperforms, and the leading indicator for each.
Format: Markdown, heavy use of tables, no filler prose. Where you make an assumption, mark it
**[ASSUMPTION]** so I can correct it. Where a number is a benchmark rather than my data, mark it
**[BENCHMARK]** and name the source class.
</deliverables>

<self_check>
Before you answer, verify: (a) every mechanic names its lever, its metric, and its expected lift;
(b) nothing in the output would require fabricated data to operate; (c) the mobile path and the
accessibility fallback are specified, not hand-waved; (d) the B2B buyer never hits a consumer
dead end; (e) the v0 in deliverable 9 could genuinely ship in a week. Fix any failures, then
answer. Do not preface the answer with a summary of these instructions.
</self_check>
```
