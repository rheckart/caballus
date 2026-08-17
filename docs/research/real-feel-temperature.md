# Real-feel temperature: weather API selection

**Status:** research complete, recommendation pending implementation
**Date:** 2026-08-08
**Question:** Which weather API should Caballus use to obtain real-feel / apparent temperature for a single fixed US location?

---

## TL;DR

**Use Open-Meteo** (`apparent_temperature`) as the primary source, and treat the US National Weather Service (`api.weather.gov`) as a free, no-signup fallback.

The deciding factor is not price or rate limits — at one location and a handful of calls per day, almost every candidate is free. It is that **Caballus needs a single continuous number that is meaningful at both ends of the scale**, and the candidates differ sharply on that point in ways their marketing copy does not reveal.

> ⚠️ **Read the [equine indices section](#equine-comfort-indices-the-uncomfortable-finding) before building threshold logic.** Human "feels like" is not the metric the equine world uses for heat stress, and there is no equine cold index at all. The API choice below is still correct — Open-Meteo returns every input needed for all the competing conventions — but the _threshold model_ should not assume one scalar per horse.

---

## Why this is a decision input, not a display value

From `brainstorming_document.md`:

> Morning feed shift: Check real-feel temperatures for the day. If temperatures are above or below horses' threshold, take appropriate measures — sheets or blankets in cold weather, fans in hot weather, horses turn-in and remain in stalls if too hot or cold, if cold ensure water heaters are on.

This imposes four requirements that eliminate several candidates:

1. **One numeric field, compared against a per-horse threshold.** Not a pair of fields (heat index / wind chill) that the app must switch between.
2. **Meaningful year-round.** A field that only "works" in summer is useless for the blanket decision.
3. **Forecast, not just current.** The morning shift decides the _day's_ plan.
4. **Cacheable.** Volunteers are in a barn on poor connectivity. The value must be storable locally.

Requirement 4 alone disqualifies one otherwise-capable vendor (see Tomorrow.io below).

---

## The crux: "feels like" is not one thing

Four genuinely different computations hide behind similar field names:

| Computation                                          | Inputs                                    | Valid range                                              | Notes                                     |
| ---------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| **Heat index** (NWS/Rothfusz)                        | temp, humidity                            | Hot only — NWS computes it above 80 °F                   | Undefined in cold                         |
| **Wind chill** (NWS 2001)                            | temp, wind                                | Cold only — NWS computes it at ≤ 50 °F with wind > 3 mph | Undefined in heat                         |
| **Apparent temperature (Steadman / Australian BOM)** | temp, humidity, wind, **solar radiation** | Continuous, all temperatures                             | One formula, no regime switch             |
| **WBGT**                                             | temp, humidity, wind, solar, radiant heat | Heat stress only                                         | Requires solar/globe input; used in sport |

The critical distinction for Caballus is **piecewise vs. continuous**:

- **Piecewise** providers (NWS, Visual Crossing, OpenWeatherMap-style) select heat index _or_ wind chill _or_ plain air temperature depending on which regime the temperature falls into. There is a **dead band** in the middle where "feels like" is literally just the air temperature.
- **Continuous** providers (Open-Meteo, Pirate Weather, Tomorrow.io) apply a single Steadman-derived formula at every temperature, so humidity and wind always influence the result.

### The NWS dead band, quantified

The National Digital Forecast Database defines its `apparentTemperature` element explicitly ([NDFD definitions](https://graphical.weather.gov/supplementalpages/definitions.php)):

> Apparent Temperature is the perceived temperature derived from either a combination of temperature and wind (Wind Chill) or temperature and humidity (Heat Index) for the indicated hour.

with these thresholds:

- temperature **≤ 50 °F** → wind chill is used
- temperature **> 80 °F** → heat index is used
- **between 51 and 80 °F → apparent temperature _is_ the ambient air temperature**

I verified this empirically against the live API and against a year of hourly data for Chester County, PA (typical US horse country, 40.0379, -75.6280):

| Regime                                          | Hours in 2025 | Share of year |
| ----------------------------------------------- | ------------- | ------------- |
| air ≤ 50 °F — wind chill applied                | 3,615         | 41.3 %        |
| **51–80 °F — apparent == air temp (dead band)** | **4,509**     | **51.5 %**    |
| air > 80 °F — heat index applied                | 636           | 7.3 %         |

So for **just over half the year, NWS's `apparentTemperature` carries no feels-like signal at all.** In 31.8 % of those dead-band hours, Open-Meteo's continuous formula differs from plain air temperature by 5 °F or more.

**Does that matter for horses?** Mostly no — 51–80 °F is the comfortable range where no blanket or fan action is needed anyway. But it matters **at the lower edge**, and that edge is real: clipped horses, thin-coated breeds, seniors, and wet horses are commonly blanketed in the 50–60 °F range, especially in wind and rain. NWS will report a flat 55 °F on a windy, wet 55 °F day; Open-Meteo will report meaningfully lower. If per-horse thresholds are ever set in the 50s, the NWS field silently degrades to air temperature.

### Live cross-check: the two leading candidates disagree substantially

36 aligned hours, same coordinates, apparent temperature in °F (Open-Meteo minus NWS):

- mean **+1.8 °F**
- range **−11.5 °F to +9.6 °F**

The mean is small; the spread is not. Part of this is genuine model disagreement on air temperature, but much of it is formula difference — Open-Meteo adds a solar-radiation term that NWS's heat index does not have.

> **Implication for the data model:** a per-horse threshold is calibrated _to a specific provider's scale_. Thresholds are **not portable** between providers. Store the provider (and ideally the formula version) alongside the threshold, or a later provider swap will silently re-calibrate every horse in the barn.

---

## Open-Meteo's formula

Open-Meteo implements the Steadman / Australian Bureau of Meteorology apparent temperature ([maintainer's explanation, open-meteo discussion #651](https://github.com/open-meteo/open-meteo/discussions/651)):

```
AT = T + 0.348 * e - 0.70 * ws + 0.70 * (Q / (ws + 10)) - 4.25
```

where `e` is vapour pressure (from relative humidity), `ws` is wind speed adjusted to 2 m, and `Q = max(0, 0.1 * (shortwave_radiation - 550))` is absorbed solar energy. The docs describe it as ([Open-Meteo docs](https://open-meteo.com/en/docs)):

> the perceived feels-like temperature combining wind chill factor, relative humidity and solar radiation

Two consequences worth knowing:

- **It is continuous.** The wind term is subtracted at _all_ temperatures, so it produces wind-chill-like behaviour in cold without a regime switch. Verified against January 2024 archive data for the PA location: apparent temperature ran **8.5–11.7 °F below air temperature** on cold mornings.
- **It includes sun.** The `Q` term only engages above 550 W/m² of shortwave radiation, but on a clear summer afternoon it pushes apparent temperature well above what a humidity-only heat index would give. This is arguably _more_ correct for horses, which stand in the sun in a paddock — but it means the numbers run hotter than the heat index a volunteer might see on a phone weather app.

The second point is a UX consideration: if the app displays "real-feel 96 °F" while the volunteer's iPhone says 89 °F, that needs explaining. Label the field's source in the UI.

---

## Candidate comparison

|                         | Real-feel field                                               | Continuous year-round?      | Separate HI/WC?             | Forecast                                     | Historical                       | Free tier                                     | Key required    | Card required         | Attribution                                  |
| ----------------------- | ------------------------------------------------------------- | --------------------------- | --------------------------- | -------------------------------------------- | -------------------------------- | --------------------------------------------- | --------------- | --------------------- | -------------------------------------------- |
| **Open-Meteo**          | `apparent_temperature`, `apparent_temperature_max/min`        | **Yes** (Steadman + solar)  | No                          | Hourly + daily, 16 d                         | **Yes, free**, 80+ yrs (ERA5)    | 10k calls/day, 5k/hr, 600/min                 | **No**          | No                    | CC BY 4.0 — "Weather data by Open-Meteo.com" |
| **NWS api.weather.gov** | `apparentTemperature` (gridpoint only)                        | **No** — dead band 51–80 °F | **Yes**, plus **WBGT**      | Hourly, ~7.5 d                               | No (NCEI separate)               | Undisclosed, "generous"                       | No (User-Agent) | No                    | US public domain                             |
| **Visual Crossing**     | `feelslike`, `feelslikemax/min`                               | No — HI > 80 °F, WC < 50 °F | Yes                         | Hourly + daily, 15 d                         | Yes, 50+ yrs                     | 1,000 **records**/day                         | Yes             | No                    | None required                                |
| **WeatherAPI.com**      | `feelslike_c/_f` (hourly only)                                | Undocumented (likely)       | **Yes** + dewpoint, wetbulb | Hourly, **3 d on free**; no daily feels-like | Past 1 day on free               | 100k calls/**month**                          | Yes             | Not stated            | Required on free plan                        |
| **OpenWeatherMap**      | `main.feels_like` / `daily[].feels_like.{morn,day,eve,night}` | Undocumented                | **No**                      | 5 d/3 h free; hourly+daily need One Call     | 1979→ via One Call `timemachine` | 1M/mo free plan; One Call **1k/day** separate | Yes             | **Yes, for One Call** | ODbL — "Weather data © OpenWeather"          |
| **Tomorrow.io**         | `temperatureApparent`                                         | Yes                         | No (has WBGT)               | 14 d (docs) / 5 d (marketing)                | 6–24 h on free                   | 500/day, **25/hr**, 3/s                       | Yes             | Unverified            | **"Powered by Tomorrow.io"** required        |
| **Pirate Weather**      | `apparentTemperature`, `apparentTemperatureHigh/Low`          | Yes (Steadman 1994 + solar) | No                          | Hourly + daily                               | Yes                              | 10k calls/**month**                           | Yes             | No                    | Sponsor-funded, see risk                     |

---

## Per-candidate notes

### Open-Meteo — RECOMMENDED

**Field.** `apparent_temperature` in `current`, `hourly`, and 15-minutely blocks; `apparent_temperature_max`, `apparent_temperature_mean`, `apparent_temperature_min` in `daily` ([docs](https://open-meteo.com/en/docs)). The daily max/min matters — the morning shift wants "how hot will it get today", and Open-Meteo provides that directly rather than requiring client-side aggregation.

**Verified live, no API key, HTTP 200:**

```
https://api.open-meteo.com/v1/forecast
  ?latitude=40.0379&longitude=-75.6280
  &current=temperature_2m,relative_humidity_2m,apparent_temperature
  &daily=apparent_temperature_max,apparent_temperature_min
  &temperature_unit=fahrenheit&timezone=America/New_York
```

**Free tier.** 600 calls/min, 5,000/hr, **10,000/day** ([pricing](https://open-meteo.com/en/pricing)). The GitHub README frames this as fair use: "If your application exceeds 10'000 requests per day, please contact us." At a handful of calls per day this is not a constraint by three orders of magnitude. **No API key, no account, no credit card.**

**Historical.** The archive API (`archive-api.open-meteo.com`) serves `apparent_temperature_max/min` back decades, free and keyless — verified live for January 2024. This directly satisfies the "correlate past care decisions with conditions" nice-to-have, and it is the only candidate that gives historical apparent temperature with **zero** signup friction.

**Licence.** API data under **CC BY 4.0**; attribution "Weather data by Open-Meteo.com" linking to https://open-meteo.com/. Source code AGPLv3. A single line in an About screen discharges this.

**The one real caveat: "free API is for non-commercial use."** Open-Meteo's pricing page states this and does not define "commercial." A 501(c)(3) horse rescue running an internal operations tool is a sympathetic case, and the CC BY 4.0 data licence itself carries no non-commercial restriction (CC BY, not CC BY-NC). But the terms are ambiguous enough that **one email to info@open-meteo.com is worth sending** before launch. If they say no, the paid Standard tier (1M calls/month) is the fallback and would be enormous overkill.

**Longevity.** Self-hosted, open source under AGPLv3, and — uniquely among the candidates — **you can run it yourself** if the hosted service ever disappears. That is a meaningful hedge that no proprietary vendor offers.

### US National Weather Service — RECOMMENDED AS FALLBACK

**This is the biggest surprise in the research.** The `/gridpoints` endpoint exposes far more than the documentation suggests. Verified live against `api.weather.gov/gridpoints/PHI/33,80`, the response contains **all four** of:

- `apparentTemperature` (149 hourly values, ~7.5 days)
- `heatIndex`
- `windChill`
- **`wetBulbGlobeTemperature`** — 136 hourly values

WBGT is the metric FEI-style equine heat-stress guidance is built on, and NWS gives it away free, hourly, with no API key. No commercial API in this comparison offers WBGT on a free tier.

I confirmed the piecewise behaviour empirically: in August at the PA location, `windChill` had **one** value and it was `null`, while `heatIndex` had 144 values and `apparentTemperature` matched `heatIndex` exactly in hot hours and matched plain `temperature` exactly in the 51–80 °F band.

**Serious implementation friction, though:**

1. **`apparentTemperature` is only in the raw `/gridpoints` payload**, not in the friendly `/gridpoints/{...}/forecast` periods — I checked, and the period objects carry only `temperature`, no apparent temperature.
2. **Current observations have no `apparentTemperature` at all.** Station observations (`/stations/{id}/observations/latest`) expose `heatIndex` and `windChill` separately — verified: `heatIndex` 25.9 °C, `windChill` `null`. To get a current real-feel you must implement the piecewise selection yourself.
3. **No daily max/min apparent temperature layer.** There are `maxTemperature`/`minTemperature` but no apparent equivalent — you must aggregate the hourly series yourself to answer "how hot will today feel."
4. **`validTime` uses run-length encoding.** Durations are not uniformly `PT1H` — the live payload contained `PT1H` ×128, `PT2H` ×12, `PT3H` ×6, `PT4H` ×1, `PT5H` ×1. Naive parsers that assume hourly rows will silently drop hours.
5. Values are always in `wmoUnit:degC` regardless of request.

**Free tier.** No API key. A `User-Agent` header identifying the app with a contact email is **required** ([FAQ](https://weather-gov.github.io/api/general-faqs)). Rate limit is deliberately undisclosed: "The rate limit is not public information, but allows a generous amount for typical use" ([docs](https://www.weather.gov/documentation/services-web-api)). Data is US Government public domain, free for any purpose.

**Risks.** The FAQ states: "In the future we will replace the User-Agent requirement with a more typical API key system" — a planned future change. Community reports document **observation delays of up to several hours** on some stations ([weather-gov/api discussion #751](https://github.com/weather-gov/api/discussions/751)). And it is a government service subject to funding and staffing pressure. Forecast (gridpoint) data has been more reliable than observations.

**No historical archive** — `api.weather.gov` is forecast/current only; climate archives live at NCEI, a separate and much clunkier system.

### Visual Crossing — STRONGEST RUNNER-UP

**Field.** `feelslike`, `feelslikemax`, `feelslikemin`, present in `days[]`, `hours[]`, and `currentConditions` from the single Timeline endpoint. The docs are unusually candid about the piecewise construction ([weather data documentation](https://www.visualcrossing.com/resources/documentation/weather-data/weather-data-documentation/)):

> Heat Index: Values are only calculated when the temperature is greater than 80F (about 26.7C) and the relative humidity is greater than 40%. An empty value is returned outside of these ranges.
> Wind Chill: Values are only calculated when the temperature is less than 50F (about 10C) and the wind speed is greater than 3mph (5kph). An empty value is returned outside of these ranges.
> Temperature, heat index and wind chill are combined into a single "feelslike" element for clarity and ease of use.

So it has the same dead band as NWS, but it _does_ correctly give one blended year-round field — which is exactly the shape Caballus wants.

**Free tier — and the accounting is better than it looks.** 1,000 **records**/day. The unit is unusual and it works in our favour ([what is a weather record](https://www.visualcrossing.com/resources/documentation/weather-data/what-exactly-is-a-weather-record/)):

> A full 15-day forecast for one location counts as a single record. **This is true even for an hourly forecast.**

One location, one 15-day hourly forecast = **1 record**. Polling every 15 minutes all day = 96 records, under 10 % of quota. Historical is where it gets expensive: one day of _hourly_ history = 24 records, so a year of hourly backfill ≈ 8,760 records ≈ 9 days of quota.

**Why it loses to Open-Meteo:** requires an API key and account; the dead band; and an unresolved contradiction in their own terms — the free-plan page says "Developers and businesses can begin building applications using the free plan," while the licence terms tie commercial rights to a **paid** licence. Storage/caching rights are also described as license-level dependent, which is unverified for the free tier and matters for an offline-first app.

### Tomorrow.io — NOT RECOMMENDED

Technically capable: `temperatureApparent` is a continuous blended field ([core data layers](https://docs.tomorrow.io/reference/data-layers-core)), defined as "the temperature equivalent perceived by humans, caused by the combined effects of air temperature, relative humidity, and wind speed (at 2m)." It also offers WBGT. Well funded (>$185M raised).

**Two clauses in the terms of service are disqualifying for this project** ([ToS](https://www.tomorrow.io/terms-of-service/)):

1. > Commercial use is strictly prohibited in the case of evaluation, proof of concept, or in connection with **self-generated accounts originated on Company's website.**

   A self-signup free account cannot be used commercially, regardless of how "commercial" is interpreted for a nonprofit.

2. Subscribers cannot "store or otherwise collect or copy the unaltered Datafeed" unless expressly permitted. **This directly conflicts with the offline-first caching that a barn-on-poor-connectivity app requires.**

Additionally: mandatory clickable "Powered by Tomorrow.io" attribution near the data _"or any information derived from it"_ — arguably covering a derived blanket recommendation, not just a temperature readout. And the free tier's **25 calls/hour** ceiling is the binding constraint, not the 500/day.

Their own docs and marketing page also disagree on free-tier history (6 h vs 24 h) and forecast horizon (14 d vs 5 d), which is circumstantial evidence of unannounced tier changes.

### Pirate Weather — INTERESTING, BUT A LONGEVITY RISK

A Dark Sky-compatible API serving NOAA models (GFS/HRRR/NBM/ECMWF) via AWS Lambda. `apparentTemperature` uses "the Steadman 1994 approach" plus solar radiation, and is present in `currently`, `hourly`, and `daily` (with `apparentTemperatureHigh`/`Low`/`Min`/`Max`) ([docs](https://docs.pirateweather.net/en/latest/API/)). Field coverage is genuinely excellent — arguably the best-shaped daily aggregates of any candidate.

**But:** the free tier is **10,000 calls/month**, not per day — two orders of magnitude tighter than Open-Meteo (still ample for this use case, at ~330/day). More importantly it is a **solo-maintained, donation-funded project**; the maintainer has publicly noted that AWS costs are paid personally while paying back student loans, and that the free tier depends on sponsors. For a volunteer-run rescue that needs this to still work in three years, that is a real risk. Reasonable as a secondary; not as the primary.

---

### OpenWeatherMap — NOT RECOMMENDED

**Field.** `main.feels_like` on the free Current Weather 2.5 and 5-day/3-hour forecast endpoints. The richer shape — `daily[].feels_like.{morn,day,eve,night}` — exists only in One Call ([One Call 4.0](https://openweathermap.org/api/one-call-4)).

**No published definition.** The only official wording, repeated across every doc page, is one sentence: _"This temperature parameter accounts for the human perception of weather."_ There is **no formula, no threshold documentation, and no separate heat-index or wind-chill field anywhere in the API**. Whether `feels_like` behaves correctly at both ends of the scale is **undocumented and unverified** — and unlike WeatherAPI, there is no sibling field to check it against.

**The free-tier trap.** There are two different free tiers and the useful one costs a credit card:

- **Standard Free plan**: 60 calls/min, 1M calls/month — but **excludes One Call, hourly-4-day, and daily-16-day forecasts** ([pricing](https://openweathermap.org/price)).
- **One Call by Call**: 1,000 calls/day free, but **requires credit card details on file**. From OWM's own migration doc: _"the One Call API 3.0 subscription requires credit card details. We use your payment card details only for those calls that go beyond the free limit"_ ([transfer doc](https://openweathermap.org/api/one-call-transfer)). Overage is **charged by default, not blocked** — _"You will be automatically charged at the end of your subscription months"_ ([FAQ](https://openweathermap.org/faq)). You can cap it manually via Billing plans → daily API call limit, but the default limit is reportedly higher than the free allowance, so **an unattended bug in a call loop bills your card.**

**Worst stability record of any candidate.** One Call 2.5 was **hard-closed in June 2024**, forcing migration to a card-required 3.0 ([deprecation notice](https://openweathermap.org/api/one-call-api)). Roughly two years later, 3.0 is itself superseded — _"We recommend using One Call API 4.0 for all new integrations"_ — with no published sunset date for 3.0. The pattern of forcing paid migrations is the relevant risk signal for a solo-maintained volunteer project.

**Licence.** ODbL, with visible attribution "Weather data © OpenWeather" required near the data ([licences](https://openweathermap.org/full-price#licenses)).

For a one-location, few-calls-per-day rescue app, putting a credit card on file with billing-by-default overage to obtain an undocumented `feels_like` is a poor trade.

### WeatherAPI.com — SOLID, BUT LOSES ON FORECAST DEPTH AND CACHING

**Best field coverage for explaining _why_ a threshold fired.** Unlike OWM, it ships `feelslike_c/_f`, `heatindex_c/_f`, `windchill_c/_f`, `dewpoint_c/_f`, `gust_*`, `uv` as **independent side-by-side fields**, and added `wetbulb_c/_f` in July 2026 ([docs](https://www.weatherapi.com/docs/), [changelog](https://www.weatherapi.com/api-changelog.html)). Because heat index and wind chill are exposed separately, `feelslike` is almost certainly the blended year-round value — but this is **inference, not documented**; no formula is published.

**Free tier.** 100,000 calls/**month**, commercial use explicitly permitted (the pricing table marks both Commercial and Non-Commercial "Yes" for Free). Exceeding returns a hard 403 block rather than a charge — much safer than OWM's billing model ([pricing](https://www.weatherapi.com/pricing.aspx)).

**Three limitations that matter here:**

1. **Forecast is only 3 days on the free plan**, versus 16 for Open-Meteo.
2. **No daily-level feels-like.** The `forecast.forecastday[].day` object has max/min/avg temp but **no `feelslike`** — you must aggregate the hourly array yourself to answer "how hot will today feel."
3. **Contractual caching limits.** Verbatim from [terms](https://www.weatherapi.com/terms.aspx): _"current conditions data — maximum 60 minutes; forecast data — maximum 24 hours."_ For an offline-first barn app this is a real constraint, though far milder than Tomorrow.io's outright prohibition — 24 h of cached forecast covers a shift comfortably.

Attribution is **mandatory on the free plan**: _"you will credit WeatherAPI.com by name or brand logo as the source of the data."_ One API key may be used for **one application only**. Their terms also require a safety disclaimer when displaying data — worth noting given Caballus uses this for animal welfare decisions.

**Stability is clean** — the published changelog 2024→Jul 2026 shows only additive changes, no deprecations or removals. This is the best stability record among the commercial vendors.

---

## Equine comfort indices: the uncomfortable finding

**There is no single standard equine comfort index, and the two authorities that matter disagree with each other.** This section materially qualifies the whole ticket.

### For heat, US practice uses a temp+humidity sum — not "feels like"

US Equestrian, crediting AAEP, publishes a scale based on **air temperature in °F plus relative humidity in %** ([USEF heat alert](https://www.usef.org/media/press-releases/heat-alert-clarification-recommendations-for)):

| Sum (°F + RH%) | Guidance                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| < 130          | Normal; cooling effective                                                  |
| 130–150        | Begin monitoring for heat stress; cooling decreased                        |
| 150–180        | Critical to monitor; cooling greatly reduced                               |
| > 180          | Alternative competition times encouraged; "potentially fatal under stress" |

The same scale appears at [UMN Extension](https://extension.umn.edu/horse-care-and-management/caring-horses-during-hot-weather) and [Rutgers Equine Science Center](https://esc.rutgers.edu/ru-beating-the-heat-2/). **USEF explicitly warns this is not the National Weather Service heat index**, and states "There is no rule set forth on when to compete."

**Provenance is weak.** No primary publication for the 130/150/180 numbers could be located. USEF credits AAEP; AAEP's public site does not surface the scale; UMN and Rutgers publish it with no citation. Rutgers describes it merely as "a formula in the equine community." Treat it as **institutionally endorsed convention with no published derivation.**

### FEI explicitly rejects that sum, and rejects human comfort indices generally

From the FEI's _Preparation for and Management of Horses and Athletes During Equestrian Events Held in Thermally Challenging Environments_ (Marlin, Misheff & Whitehead, March 2018):

> This index should never be used for managing horses in hot or hot humid conditions as it has previously been demonstrated to be extremely unreliable and could lead to inappropriate decisions being made and a major risk to horse and athlete welfare.

FEI further notes that generic human indices "have been developed for non-exercising people and not for exercising horses," and states: **"The only validated heat index for equestrian sport is the WBGT index."**

FEI eventing thresholds (cross-country, acclimatised horses): < 28 °C no change; 28–30 precautions; 30–32 additional precautions; 32–33 hazardous; > 33 probably not compatible with safe competition.

**But WBGT needs natural wet-bulb and black-globe temperature**, measured in full sun. FEI's practical answer is a handheld meter (~US$160). **NWS is the one API here that publishes forecast WBGT for free** — which is why it earns its place as fallback even though its `apparentTemperature` has a dead band.

### THI is a cattle index — do not use it

Equine papers that report THI use the **unmodified livestock formula**; the citation chain leads to other equine papers that also just borrowed it. The literature review [Kang et al. (2023), _Int. J. Biometeorology_ 67:957–973](https://d-nb.info/1303005778/34) concludes: _"there is a lack of any standardized method or validated interpretation of heat stress in horses."_ No equine-derived coefficients, no equine thresholds.

### For cold, there is no index at all

Only the lower critical temperature (LCT) concept, and published values span a 30+ °F range depending on coat, acclimatisation and body condition:

- **−15 °C** cold-adapted Quarter Horses (McBride et al. 1985)
- **−11 °C** cold-adapted Warmblood yearlings (Cymbaluk & Christison 1988)
- **−9 to −16 °C** Standardbred/Finnhorse yearlings, loose housing (Autio et al. 2007)
- **≈ +5 °C** stabled at night, not winter-acclimatised

(reviewed in [Mejdell, Bøe & Jørgensen 2020](https://www.sciencedirect.com/science/article/pii/S0168159120301593); thermoneutral zone 5–25 °C per Morgan 1998)

[UMN Extension](https://extension.umn.edu/horse-care-and-management/caring-your-horse-winter) gives practical numbers: LCT "41 °F with a summer coat and 18 °F with a winter coat"; blanket when turned out without shelter and "temperatures or wind chill drop below 5 °F"; also blanket if the horse may get wet, is clipped, very young or old, not acclimated, or body condition score ≤ 3.

**Wind and wet matter more than air temperature.** Mejdell et al. identify "chilly rain combined with wind" as among the most demanding conditions. There is **no equine wind-chill formula** — the widely repeated "20 mph wind lowers effective temperature 15–20 °F for a horse" traces to magazine content, not research, and should be flagged as folklore.

---

## Recommendation

### Primary: Open-Meteo

- Only candidate with a **genuinely continuous** apparent temperature that is meaningful at both ends of the scale, with a **published formula** (Steadman/BOM).
- **No API key, no account, no credit card** — the lowest possible integration and maintenance burden for a solo developer.
- 10,000 calls/day free against a requirement of ~5/day: four orders of magnitude of headroom.
- **Free historical archive** with the same `apparent_temperature` field, satisfying the correlation nice-to-have with zero extra vendor.
- Returns **everything needed for every index discussed above** in a single call: `temperature_2m`, `relative_humidity_2m`, `apparent_temperature`, `wind_speed_10m`, `shortwave_radiation`, `precipitation`.
- AGPLv3 and self-hostable — the only candidate with a genuine escape hatch.

**Action before launch:** email info@open-meteo.com to confirm a 501(c)(3)'s internal operations tool is acceptable under "the free API is for non-commercial use." The data licence itself is CC BY 4.0 (not NC), so this is likely fine, but get it in writing.

### Fallback: US National Weather Service

Free, no key, US public domain, and the **only free source of forecast WBGT** — the one index FEI calls validated for horses. Use it as a redundancy path and as the source if WBGT-based heat rules are ever implemented. Accept the parsing friction (raw gridpoint only, run-length-encoded `validTime`, no daily aggregates, °C only) and the observation-latency risk.

### Runners-up

**Visual Crossing** — best commercial option. 1,000 records/day where a full 15-day hourly forecast costs 1 record, no attribution requirement, 50+ years of history, and unusually honest documentation of its piecewise construction. Loses only on requiring an account and having the same dead band as NWS.

**WeatherAPI.com** — cleanest stability record of the commercial vendors, 100k calls/month, commercial use explicitly permitted, hard-block instead of billing on overage, and the richest set of discrete fields (`heatindex`, `windchill`, `dewpoint`, `wetbulb`). Loses on a 3-day free forecast, no daily-level feels-like, and a contractual 60-minute cache limit on current conditions.

### Rejected

- **Tomorrow.io** — self-signup accounts are contractually barred from commercial use, and caching the datafeed is prohibited, which is incompatible with an offline-first barn app.
- **OpenWeatherMap** — credit card required for the useful tier, overage billed by default, `feels_like` completely undocumented, and a track record of forcing paid migrations.
- **Pirate Weather** — technically excellent field coverage, but solo-maintained and donation-funded; unacceptable continuity risk for a volunteer organisation.

---

## Implementation notes for whoever builds this

1. **Store the metric alongside the threshold, not a bare number.** Per-horse thresholds should carry an enum — `air_temp`, `apparent_temp`, `temp_plus_humidity_sum`, `wbgt` — so the heat side and cold side can use different conventions without pretending they're the same axis, and so WBGT can be added later without a migration.

2. **Thresholds are provider-calibrated and not portable.** Measured divergence between Open-Meteo and NWS apparent temperature at the same coordinates: mean +1.8 °F, range −11.5 to +9.6 °F. Record the provider (and ideally formula version) with the threshold. A provider swap silently re-calibrates every horse in the barn.

3. **Model cold as LCT plus independent modifier flags**, not as one scalar. There is no equine wind-chill formula to fold wind and wet into a single number. Flags the alert logic should read separately: precipitation/wet coat, wind above threshold, clipped, body condition ≤ 3, very young/old, not acclimated, shelter available.

4. **Persist every weather reading used in a shift decision.** Care events are historical logs (per `CLAUDE.md`); "why was this horse blanketed" needs the conditions as they were read at the time, not a re-fetch. Store the raw fields, not just the derived recommendation.

5. **Cache aggressively.** Open-Meteo's CC BY 4.0 licence imposes no cache limit, so a morning fetch can serve the whole shift offline. This is a concrete advantage over WeatherAPI (60 min on current conditions) and Tomorrow.io (prohibited).

6. **Label the source in the UI.** Open-Meteo's solar term makes its numbers run hotter than a phone weather app's heat index. A volunteer seeing "real-feel 96 °F" against their iPhone's 89 °F needs an explanation, or they will distrust the app.

7. **Do not present the temp+RH sum as authoritative.** If implemented, note in the UI or docs that the 130/150/180 bands are US convention for _exercise_ decisions, lack a published derivation, and are disputed by FEI at moderate-to-high humidity.

---

## Sources

- [Open-Meteo docs](https://open-meteo.com/en/docs), [pricing](https://open-meteo.com/en/pricing), [features](https://open-meteo.com/en/features), [GitHub/licence](https://github.com/open-meteo/open-meteo), [apparent temperature formula discussion](https://github.com/open-meteo/open-meteo/discussions/651)
- [NWS API docs](https://www.weather.gov/documentation/services-web-api), [community FAQ](https://weather-gov.github.io/api/general-faqs), [NDFD definitions](https://graphical.weather.gov/supplementalpages/definitions.php), [observation-delay discussion](https://github.com/weather-gov/api/discussions/751)
- [Visual Crossing data documentation](https://www.visualcrossing.com/resources/documentation/weather-data/weather-data-documentation/), [what is a record](https://www.visualcrossing.com/resources/documentation/weather-data/what-exactly-is-a-weather-record/), [free plan](https://www.visualcrossing.com/resources/documentation/visual-crossing-weather-free-plan-free-weather-data-for-analysts-and-api-developers/), [terms](https://www.visualcrossing.com/weather-services-terms/)
- [WeatherAPI docs](https://www.weatherapi.com/docs/), [pricing](https://www.weatherapi.com/pricing.aspx), [terms](https://www.weatherapi.com/terms.aspx), [changelog](https://www.weatherapi.com/api-changelog.html)
- [OWM Current](https://openweathermap.org/current), [One Call 4.0](https://openweathermap.org/api/one-call-4), [2.5 deprecation](https://openweathermap.org/api/one-call-api), [2.5→3.0 transfer](https://openweathermap.org/api/one-call-transfer), [pricing](https://openweathermap.org/price), [full pricing/licences](https://openweathermap.org/full-price), [FAQ](https://openweathermap.org/faq)
- [Tomorrow.io core data layers](https://docs.tomorrow.io/reference/data-layers-core), [free plan limits](https://support.tomorrow.io/hc/en-us/articles/20273728362644-Free-API-Plan-Rate-Limits), [terms of service](https://www.tomorrow.io/terms-of-service/)
- [Pirate Weather API docs](https://docs.pirateweather.net/en/latest/API/), [project site](https://pirateweather.net/)
- Equine: [USEF heat alert](https://www.usef.org/media/press-releases/heat-alert-clarification-recommendations-for), [USEF heat index update](https://www.usef.org/media/press-releases/us-equestrian-competition-update-heat-index), [UMN hot weather](https://extension.umn.edu/horse-care-and-management/caring-horses-during-hot-weather), [UMN winter care](https://extension.umn.edu/horse-care-and-management/caring-your-horse-winter), [Rutgers ESC](https://esc.rutgers.edu/ru-beating-the-heat-2/), [Kang et al. 2023 heat stress review](https://d-nb.info/1303005778/34), [Mejdell et al. 2020 cold climate review](https://www.sciencedirect.com/science/article/pii/S0168159120301593), FEI thermally challenging environments guidance (Marlin, Misheff & Whitehead 2018)

### Verification status

Verified live against the APIs: Open-Meteo forecast, archive, and field shapes (no key, HTTP 200); NWS gridpoint layer inventory, `validTime` encoding, observation fields, and the 51–80 °F dead band; the Open-Meteo↔NWS divergence measurement; the 2025 regime breakdown.

Explicitly **unverified**: OWM's per-call overage price and exact default daily cap; whether OWM/WeatherAPI `feels_like` blends both regimes (no vendor formula published); whether a credit card is required for Tomorrow.io, Visual Crossing, or WeatherAPI signup; whether Visual Crossing's free tier carries commercial rights (their own pages contradict each other); Tomorrow.io's free-tier forecast horizon (docs say 14 d, marketing says 5 d).
