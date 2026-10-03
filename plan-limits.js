/* Free-plan limits — the single place to change them.
   Used by the research tool (index.html) and the Plans page (pricing.html).
   Subscribers on any paid plan get everything without limits. */
window.CASEBOUND_FREE = {
  analysesPerDay: 3,   // new analyses per day (reopening a saved case doesn't count)
  savedCases: 3,       // cases kept in the Cases tab
  fileUpload: false    // reading PDF / Word / text files into the facts field
};
