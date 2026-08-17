# Caballus Brainstorming Document

## Overview

The Caballus application will assist horse rescues in the care and coordination of their animals. The application should eventually cover all aspects of horse rescue functionality, from keeping track of animal information to reports about the animals, volunteers, facilities, etc.

## Horse Care: Detailed Brainstorming for Mobile-First Rescue App

### Horse Profiles: Deep Data Capture

- Basic details: name, photo, breed, color, sex, microchip, markings, foaling date, origin, age (calculated if date of birth is known), date of birth (sometimes not known).
- Status and tracking: intake date, acquisition reason (surrender, seizure, stray), rescue/foster/adoption status.
- Special needs: temperament, behavioral notes, training history, allergies or sensitivities.
- Current housing: stall number, barn location name.
- Current turnout location: Paddock name, letter or number.

### Feeding & Nutrition

- Feed schedules: types of feed (often combined), amount of water to add to feed, forage, supplements, medications to be added to feed, eating times.
- Logging feed changes (product, amount, frequency), reasons (veterinary advice, weight change).
- Weight/body condition tracking and adjustment history.
- Water intake logs, especially in hot weather or for horses at risk of colic.
- Alerts for special diets (Cushing’s, metabolic syndrome, allergies).

### Medical Care

- Vaccination records: schedule (core and risk-based), reminders, history.
- Deworming: product, date, target parasites, results of fecal egg counts.
- Medical conditions: chronic issues (laminitis, COPD, arthritis), episode logs, treatment plans.
- Injuries or illnesses: diagnosis, ongoing symptom logs, medication/treatment records.
- Vitals tracking: temperature, pulse, respiration, mucous membrane color, gut sounds.

### Dental Care

- Dental examination history (date, findings, photos if available).
- Floating and procedures: practitioner, sedation used, tooth charts.
- Notes on bite issues, difficulty eating, or behavior changes linked to dental pain.
- Schedule and track next planned dental visit, with overdue alerts.

### Farrier Care

- Hoof trim/shoeing schedule per horse.
- Farrier notes: hoof conformation, issues (e.g., white line disease, abscesses), shoe type used, corrective work done.
- Photographic hoof records pre/post farrier work.
- Owner/farrier/manager communication log for hoof care.

### Daily Care & Wellness

- Detailed daily log options: appetite, manure frequency/consistency, hydration, mood, turnout/exercise, new behaviors.
- Turnout rotation: pasture vs. paddock, companions, length of turnout.
- Grooming records: schedule, skin/coat condition, tips for identifying parasite infestation (lice/ticks).
- Parasite management: treatments (topical, systemic), assessment results.
- Grooming schedule: when and how often grooming is performed.
- Temperature considerations
  - If the real-feel temperature is too hot, horses often stay inside
  - If the real-feel temperature is too cold, horses often wear a sheet or a blanket

### Behavioral & Training

- Baseline temperament, changes or triggers to flag (e.g., aggression, withdrawal).
- Program for socialization, groundwork, enrichment activities.
- Training and progress notes, customizable goals/milestones.
- Log interventions for behavioral issues, responses.

### Emergency Care

- Store and highlight emergency contacts (vet, farrier, key staff).
- Quick-access action lists for colic, injury, severe weather, evacuation.
- Option to flag at-risk horses for medical/behavioral emergencies.

### Adoption, Fostering & Transfer

- Adoption eligibility checklist: health, training, behavioral assessments.
- Home visit/inspection notes for potential adopters.
- Post-adoption follow-up schedule, outcomes and notes.
- Legal agreements storage (adoption, foster, relinquishment).

### End-of-Life & Memoriam

- Quality-of-life scoring/logs.
- Decision tracking for euthanasia (consultation notes, team input, scheduling).
- Final vet, cremation, or burial documentation.
- Memorial notes/photos for organizational and supporter remembrance.

### Staff, Volunteer & Visitor Interaction Logs

- Caregiver shift notes/handovers per horse.
- Feedback or observations from visitors, volunteers, trainers.

### Automated Alerts & Reminders

- Critical medication reminders, urgent care tasks.
- Proactive alerts for seasonal/vaccination trends (e.g., spring/fall shots, fly control).
- Flag lapses in logging or overdue tasks for prompt attention.

### Documentation & Compliance

- Attach test results, vet documents, adoption forms to horse profiles.
- Track regulatory requirements (Coggins, health certificates).
- Audit logs for all record changes.

This expanded brainstorming list ensures a robust foundation for the application to support nuanced, real-world needs in equine rescue settings. These details should drive both the user interface and backend data model, allowing rescue organizations to provide high-quality, individualized care with confidence and accountability.

## Rescue Personnel Roles/Personas

Rules: Volunteer members at the rescue may be included in many roles.

1. **President** - President and head of the horse rescue. Can perform all functions for all roles
1. **Board Member** - second in command to the President. Can perform all functions for all roles
1. **Treasurer** - responsible for all financial matters related to the horse rescue
1. **Head of Maintenance** - can see an act on any maintenance items & groundkeeping pertaining to the rescue
1. **Head of Horse Welfare** - can see an act on any medical, dental or farrier items pertaining to the horses at the rescue. Responsible for:
   1. Ingestion and observation of medical, dental or farrier issues reported from feed shifts
   1. Coordinating and reporting issues of medical, dental or farrier importance to volunteers
   1. Scheduling medical, dental and farrier visits
1. **Volunteer Coordinator** - overall coordinator for all volunteers. Responsible for:
   1. Orientation sessions for new volunteers
   1. Assignment of volunteers to shifts
   1. Removal of volunteers from shifts and/or the rescue itself
1. **Feed Shift Lead** - leads one or more feed shifts at the rescue. Responsible for:
   1. Assigning the start time of the feed shift
   1. Food preparation for each horse
   1. Medication for each horse
   1. Completion of all checklist items for a feed shift
   1. Supervision of volunteers on the shift
   1. Reporting any medical, dental or farrier issues to the Head of Medical
   1. Reporting any maintenance issues to the Head of Maintenance
   1. Reporting of low amounts of medicine, feed or other items that require re-order
1. **Feed Shift Co-Lead** - assists the Feed Shift Lead with one or more feed shifts at the rescue. Responsible for:
   1. Assigning the start time of the feed shift
   1. Food preparation for each horse
   1. Medication for each horse
   1. Completion of all checklist items for a feed shift
   1. Supervision of volunteers on the shift
   1. Reporting any medical, dental or farrier issues to the Head of Medical
   1. Reporting any maintenance issues to the Head of Maintenance
   1. Reporting of low amounts of medicine, feed or other items that require re-order
1. **Feed Shift Volunteer** - works under the direction of the Feed Shift Lead and the Feed Shift Co-Lead. Completes tasks assigned to them from the checklist items for a feed shift.
1. **Event Coordinator** - responsible for educational or other events at the horse rescue. Handling sign-up registration for volunteers for the event. Some examples include:
   1. Boy Scouts of America Horsemanship Badge
   1. Girl Scouts of America Horsemanship Badge
   1. Holiday Events with children & families
   1. Open House and other general public events

## Regular Feed Shift Checklist

1. Prepare food for each horse (often restricted to Feed Shift Lead or Co-Lead)
1. Prepare or administer medication for each horse (often restricted to Feed Shift Lead or Co-Lead)
1. Turn-in or turn-out horses
1. Morning feed shift: Check real-feel temperatures for the day. If temperatures are above or below horses' threshold, take appropriate measures
   1. Sheets or blankets in cold weather
   1. Fans in hot weather
   1. Horses turn-in and remain in stalls if too hot or cold
1. Ensure hay or other food is available in each paddock, field or stall
1. Ensure water is filled and available in each paddock, field or stall
   1. If cold, ensure water heaters are on
1. Muck assigned paddocks or areas
1. Muck assigned stalls
1. Groom assigned horses
1. Apply fly spray to each horse if required
1. Apply suncreen to horses that require it
1. Sweep or clean barn areas

## Pop-up Shifts

Pop-up feed shifts can occur at any time for various reasons, including:

1. Special care or feeding of horses
1. Hosing off horses for cooling in hot conditions
1. Checking on horses in adverse weather conditions

In these types of shifts, volunteers are often asked to sign-up for those duties.
