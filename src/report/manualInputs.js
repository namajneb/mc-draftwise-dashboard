// MANUAL DATA — these numbers are entered by hand. Nothing here updates on its own.
//
// Site visit-to-demo request rate, Q3 2026 (Aug 1 – Oct 31). To refresh for a new
// period, replace the four numbers and the period/updated labels:
//   demoRequests     HubSpot → Marketing → Forms → Contact Us → Submissions (count every
//                    fill in the period; leave out internal test submissions)
//   sessions         Google Analytics → Reports → Acquisition → Traffic acquisition, total sessions
//   paidSocial       same report, the "Paid Social" row's sessions
//   engagedSessions  same report, engaged sessions total
export const VISIT_RATE_INPUTS = {
  period: "Q3",
  periodDates: "Aug 1 – Oct 31, 2026",
  updated: "Nov 12, 2026",
  demoRequests: 48,
  sessions: 81108,
  paidSocial: 27462,
  engagedSessions: 17343,
};
