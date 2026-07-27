# Wallinwood Springs CoursePilot Pilot Brief

Prepared for an initial conversation with Wallinwood Springs Golf Club.
Last reviewed: July 27, 2026.

## The decision this meeting should produce

Agree on whether Wallinwood Springs wants to test a 30-day CoursePilot AI
receptionist pilot, who will approve the course information it uses, and which
level of booking access is allowed.

The recommended first pilot works alongside Wallinwood's existing website and
TeeItUp booking system. It does not replace the tee sheet, point of sale, or
staff.

## Thirty-second explanation

CoursePilot is an AI receptionist designed for golf courses. It answers routine
phone questions, handles calls that staff cannot reach, directs golfers to the
correct booking path, and transfers calls that require a person. The pilot
would be configured with only information approved by Wallinwood Springs and
would record measurable outcomes such as calls answered, booking intent,
successful handoffs, and staff time saved.

## What is ready to demonstrate

- Customer booking flow:
  <https://coursepilotgolf.netlify.app/>
- Management view:
  <https://coursepilotgolf.netlify.app/dashboard.html>
- Secure course-based management access
- Tee-time availability, booking holds, and capacity protection
- Stripe test checkout and verified payment webhooks
- Booking and payment visibility for staff
- Provider-neutral booking API
- Text-based AI receptionist backend with request and spending limits

The current site is a CoursePilot demo. It is not yet configured with
Wallinwood's actual rates, policies, branding, or live TeeItUp inventory.

## Verified Wallinwood context

- Official site: <https://www.wallinwoodsprings.com/>
- Existing online booking:
  <https://wallinwood-springs-golf-club.book.teeitup.com/>
- The public website is powered by GolfNow Business.
- The course also promotes dining, events, banquets, and winter simulators.

These facts make an integration-first pilot the appropriate approach. The AI
should send golfers to TeeItUp until authorized provider access can support
live availability or booking.

## Recommended pilot scope

### Include in the first release

- Answer approved questions about hours, rates, policies, amenities, events,
  dining, simulators, carts, and rentals
- Recognize booking intent and text the official TeeItUp booking link
- Transfer urgent, sensitive, or unsupported requests to staff
- Use a course-approved greeting and voice
- Apply business-hours and after-hours routing rules
- Log call outcome, topic, duration, transfer, and booking-link handoff
- Provide a simple weekly pilot summary

### Add only with provider authorization

- Read live TeeItUp availability
- Create or modify a reservation
- Cancel a reservation
- Collect payment during a phone call

### Exclude from the first release

- Replacing TeeItUp, the point of sale, or Wallinwood's website
- Making promises about weather, course conditions, or availability without a
  trusted live source
- Issuing refunds or discounts
- Handling disputes, emergencies, employment questions, or legal matters

## Questions for Wallinwood management

### Calls and staffing

1. Approximately how many calls reach the pro shop on a normal weekday and
   weekend?
2. How many calls are missed, sent to voicemail, or abandoned?
3. Which hours are hardest for staff to answer the phone?
4. What are the ten most common questions?
5. Which calls must always reach a person?
6. Who should receive escalations, and what is the backup route?

### Booking operations

1. Who manages the TeeItUp/GolfNow Business relationship?
2. Is partner or API access available for reading tee times or creating
   bookings?
3. If direct access is unavailable, may CoursePilot text the official booking
   link to callers?
4. What are the rules for singles, same-day bookings, league play, outings,
   rain checks, cancellations, and no-shows?
5. Which booking changes may an automated system perform, if any?

### Approved course information

1. Seasonal golf and pro-shop hours
2. Nine-hole and eighteen-hole rates
3. Cart pricing and walking rules
4. Rental club availability and pricing
5. Simulator hours, booking rules, and pricing
6. Restaurant, event, banquet, and outing information
7. Dress code, age restrictions, pace-of-play rules, and accessibility details
8. Weather-delay, frost-delay, closure, and course-condition procedures
9. Exact answers the AI must never provide without staff confirmation

### Customer communication and privacy

1. May calls be recorded or transcribed, and what disclosure should callers
   hear?
2. May CoursePilot send one-time booking links by SMS?
3. How long should transcripts and caller information be retained?
4. Who may view calls, transcripts, and pilot reports?
5. What wording should be used when the AI is uncertain?

### Pilot approval

1. Who owns the pilot decision?
2. Which staff members will test and approve responses?
3. Which phone number or routing method can be used?
4. What start date avoids tournaments, outings, or operational disruptions?
5. If the pilot meets its targets, would Wallinwood consider a paid monthly
   service?

## Course configuration inventory

| Configuration | CoursePilot today | Needed from Wallinwood |
| --- | --- | --- |
| Course name and URL slug | Supported | Approved public name |
| Time zone | Supported | Confirm America/Detroit |
| Booking hours and interval | Supported | Seasonal schedule |
| Maximum group size | Supported | Approved rules |
| Nine- and eighteen-hole prices | Supported | Current trusted rates |
| Tax rate and currency | Supported | Accounting confirmation |
| Booking provider routing | CoursePilot provider only | TeeItUp access decision |
| Branding, logo, and colors | Not yet configurable | Brand assets and approval |
| Policies, FAQs, and amenities | Not yet stored | Approved source material |
| Carts, rentals, dining, and simulators | Not yet stored | Rules, prices, and hours |
| AI greeting, voice, and personality | Not yet configurable | Approved wording |
| Escalation and after-hours rules | Not yet configurable | Staff routing decisions |
| Confirmation and cancellation rules | Partially supported | Course-approved workflow |

Provider secrets must remain in protected server-side secrets. They must never
be stored in public course settings or browser code.

## Pilot success metrics

Targets are provisional until Wallinwood supplies one week of baseline call
data.

### Primary outcomes

1. **Missed-call coverage**
   - Definition: calls answered by CoursePilot that staff otherwise would not
     answer, divided by eligible routed calls
   - Provisional target: at least 90%
2. **Eligible call resolution**
   - Definition: routine calls completed without staff intervention, divided
     by routine calls that the pilot is approved to handle
   - Provisional target: at least 60% after the first two weeks
3. **Booking-intent completion**
   - Definition: booking-intent calls that produce a confirmed provider
     booking or successful booking-link handoff, divided by booking-intent
     calls
   - Initial target: establish the baseline during the pilot, then compare it
     with missed-call and voicemail outcomes

### Drivers

- Percentage of common questions covered by approved course information
- Percentage of sent booking links opened by the caller
- Successful staff transfer rate
- Average staff minutes avoided per resolved routine call

### Guardrails

- At least 95% factual accuracy in a weekly reviewed sample
- Zero unauthorized bookings, payments, refunds, discounts, or policy promises
- Every unsupported or sensitive request must receive an approved escalation
  or uncertainty response
- AI and telephony cost must remain within the pilot's agreed monthly cap

## Measurement plan

Before launch, collect one normal week of:

- Total inbound calls
- Answered, missed, voicemail, and abandoned calls
- Call time by hour and day
- The most common call reasons
- Bookings that staff can reasonably attribute to phone calls

During the pilot, CoursePilot should record:

- Call start and end time
- Topic and outcome
- Resolved, transferred, or unanswered status
- Booking-link sent and opened status
- Provider booking identifier only when authorized
- AI response review result
- Estimated staff time saved

Management should review a small call sample weekly. The pilot should be paused
if the AI gives unsafe information, creates unauthorized reservations, or
cannot reliably escalate.

## Suggested rollout

1. **Discovery and approval:** complete this brief and obtain an accountable
   pilot owner.
2. **Configuration:** load only approved Wallinwood facts, branding, and routing
   rules.
3. **Staff-only testing:** use a temporary number and scripted test calls.
4. **Limited live pilot:** route after-hours or missed calls before handling all
   calls.
5. **Thirty-day review:** compare outcomes with the baseline and decide whether
   to expand, revise, or stop.

## Decision record

- Pilot owner:
- Course information approver:
- Technical contact:
- Phone routing approved:
- SMS booking links approved:
- Call transcription approved:
- TeeItUp/GolfNow access owner:
- Staff-only test date:
- Limited live pilot date:
- Monthly cost cap:
- Paid-service decision date:

## Engineering decision after discovery

- If TeeItUp API or partner access is approved, build the TeeItUp provider
  adapter and validate read-only availability before allowing bookings.
- If API access is unavailable, build the voice receptionist around approved
  FAQs, staff transfer, and SMS deep links to the existing TeeItUp page.
- Do not create a separate Wallinwood codebase. Store course-specific settings
  and policies in the shared multi-course CoursePilot platform.
