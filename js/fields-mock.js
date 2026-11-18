/* ==========================================================================
   Firm Lookup → Account details — MOCKUP for the test site only (tools/build-demo.sh loads it).
   Every account field that used to live in ChurnZero (the 122 worth keeping from the 2026-10-12 audit),
   in collapsible sections that start closed, so the firm page stays short. Values are editable (with a
   change history); fields synced from Chargebee or usage are read-only. Managers get "Edit layout":
   move fields between sections, reorder them, hide or show them, add, rename, reorder or remove sections.
   Hidden fields stay documented under "Show hidden fields". Made-up values; kept in this browser only.
   ========================================================================== */
(function () {
  if (!window.CS_DEMO) return;
  // [key, label, type, team, default section, hidden by default, source, sample values, % of accounts filled]
  const CATALOG = [{"k": "OnboardingStatus", "l": "Onboarding status", "t": "enum", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["Complete", "Complete - Never Engaged", "Pre-Kickoff"], "pct": 58.9}, {"k": "NewOnboardingCall", "l": "Next onboarding call", "t": "enum", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["Sixth Onboarding", "Fifth Onboarding", "Additional Onboarding"], "pct": 41.3}, {"k": "NewTimeInOnboarding", "l": "Days in onboarding", "t": "number", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["0.0", "56.0", "70.0"], "pct": 100}, {"k": "OnboardingCompletedDate", "l": "Onboarding completed date", "t": "date", "team": "CSM", "s": "onb", "h": false, "src": "Dashboard", "v": ["2024-08-21", "2026-09-01", "2025-02-03"], "pct": 43.5}, {"k": "ImplementationType", "l": "Implementation type", "t": "enum", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["Premium Onboarding", "Basic Onboarding"], "pct": 41.6}, {"k": "ImplementationSpecialist", "l": "Implementation specialist (SF)", "t": "enum", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 62}, {"k": "TechSavvyScore1Low5High", "l": "Tech savvy score (1–5)", "t": "number", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["3", "4", "2"], "pct": 19.7}, {"k": "IntakeProcess", "l": "Intake process", "t": "long", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 61.2}, {"k": "KeyChallenges", "l": "Key challenges", "t": "long", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 43.4}, {"k": "CurrentTechStack", "l": "Current tech stack", "t": "long", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 44.8}, {"k": "PocForLeadSources", "l": "Point of contact for lead sources", "t": "long", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 26.7}, {"k": "SalesOnboardingNotes", "l": "Sales onboarding notes", "t": "long", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 18.8}, {"k": "OnboardingDeckLink", "l": "Onboarding deck link", "t": "link", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 36.6}, {"k": "OnboardingDocumentsFolder", "l": "Onboarding documents folder", "t": "link", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": [], "pct": 38.3}, {"k": "OnboardingDocumentsUploaded", "l": "Onboarding documents uploaded", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 96.1}, {"k": "DocumentsFormsApproved", "l": "Documents forms approved", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "FirstHalfOfAutomationsApproved", "l": "First half of automations approved", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "SecondHalfOfAutomationsApproved", "l": "Second half of automations approved", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "UserSettingsCompleted", "l": "User settings completed", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "TeamTrainingComplete", "l": "Team training complete", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "IntegrationsConnected", "l": "Integrations connected", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "LeadSourcesConnected", "l": "Lead sources connected", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "ImportApproved", "l": "Import approved", "t": "bool", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "DateOnboardingPaused", "l": "Date onboarding paused", "t": "date", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["2025-11-27", "2026-08-10", "2025-06-23"], "pct": 5.8}, {"k": "DateOnboardingResumed", "l": "Date onboarding resumed", "t": "date", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["2025-12-08", "2026-08-24", "2026-03-02"], "pct": 4.4}, {"k": "OnboardingTimeExcludingPause", "l": "Onboarding time excluding pause (days)", "t": "number", "team": "IM", "s": "onb", "h": false, "src": "Dashboard", "v": ["14.0", "65.0", "55.0"], "pct": 4.4}, {"k": "TimeOnboardingPaused", "l": "Time onboarding paused", "t": "enum", "team": "IM", "s": "onb", "h": true, "src": "Dashboard", "v": ["4:00 PM PST", "12:24 PM PST"], "pct": 0.1}, {"k": "AccountOnboardingTime", "l": "Onboarding time (days, old)", "t": "number", "team": "IM", "s": "onb", "h": true, "src": "Dashboard", "v": ["70.0", "56.0", "62.0"], "pct": 42.8}, {"k": "OnboardingCall", "l": "Onboarding call (old)", "t": "enum", "team": "IM", "s": "onb", "h": true, "src": "Dashboard", "v": ["Sixth Onboarding", "Additional Onboarding", "Fifth Onboarding"], "pct": 36.1}, {"k": "AccountStatus", "l": "Account status", "t": "enum", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["Active", "Churned"], "pct": 85.3}, {"k": "ChargebeeAccountStatus", "l": "Chargebee account status", "t": "enum", "team": "CSM", "s": "bill", "h": false, "src": "Chargebee", "v": ["Active", "NON_RENEWING", "Delinquent"], "pct": 87.2}, {"k": "ContractStatus", "l": "Contract status", "t": "enum", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["Active", "Completed", "Cancelled"], "pct": 51}, {"k": "InContract", "l": "In contract", "t": "bool", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 99.9}, {"k": "StartingMrr", "l": "Starting mrr", "t": "money", "team": "CSM", "s": "bill", "h": false, "src": "Chargebee", "v": ["0.0", "297.0", "306.0"], "pct": 87.2}, {"k": "CurrentMrrStartingMrr", "l": "Current MRR − starting MRR", "t": "money", "team": "CSM", "s": "bill", "h": false, "src": "Chargebee", "v": ["0.0", "247.0", "306.0"], "pct": 100}, {"k": "ChangeInMrr", "l": "Change in MRR (×)", "t": "number", "team": "CSM", "s": "bill", "h": false, "src": "Chargebee", "v": ["1.0", "0.0", "1.1"], "pct": 57.6}, {"k": "ContractStartDate", "l": "Contract start date", "t": "date", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["2025-09-29", "2026-03-31", "2026-06-30"], "pct": 79.1}, {"k": "ContractEndDate", "l": "Contract end date", "t": "date", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["2027-03-31", "2027-04-30", "2027-01-31"], "pct": 39.9}, {"k": "CurrentTermStart", "l": "Current term start", "t": "date", "team": "CSM", "s": "bill", "h": false, "src": "Chargebee", "v": ["2026-09-30T07:00:00Z", "2026-09-25T07:00:00Z", "2026-09-21T07:00:00Z"], "pct": 81}, {"k": "CurrentTermEnd", "l": "Current term end", "t": "date", "team": "CSM", "s": "bill", "h": false, "src": "Chargebee", "v": ["2026-10-30T07:00:00Z", "2026-10-31T07:00:00Z", "2026-10-25T07:00:00Z"], "pct": 81}, {"k": "RemainingBillingCycles", "l": "Remaining billing cycles", "t": "number", "team": "CSM", "s": "bill", "h": false, "src": "Chargebee", "v": ["0.0", "9.0", "10.0"], "pct": 87.2}, {"k": "AdditionalContractTerms", "l": "Additional contract terms", "t": "long", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": [], "pct": 2.7}, {"k": "LicenseCountemployee", "l": "Licenses per employee", "t": "number", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["0.0", "1.0", "0.6"], "pct": 99.9}, {"k": "PifOpportunity", "l": "PIF opportunity", "t": "bool", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 87.2}, {"k": "PremiumMigration", "l": "Premium migration", "t": "bool", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 87.2}, {"k": "CreateLegacyContractObject", "l": "Legacy contract object created", "t": "bool", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": ["True"], "pct": 42.6}, {"k": "LegacyNotes", "l": "Legacy notes", "t": "long", "team": "CSM", "s": "bill", "h": false, "src": "Dashboard", "v": [], "pct": 8.3}, {"k": "ContractionAmount", "l": "Contraction amount", "t": "money", "team": "CSM", "s": "bill", "h": true, "src": "Chargebee", "v": ["59.0", "468.0", "25.77"], "pct": 0.6}, {"k": "DateOfContraction", "l": "Date of contraction", "t": "date", "team": "CSM", "s": "bill", "h": true, "src": "Chargebee", "v": ["2026-03-26", "2026-02-28", "2026-01-13"], "pct": 0.6}, {"k": "AvgMattersCreatedmonth", "l": "Avg matters created / month", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "1.0", "2.0"], "pct": 100}, {"k": "AvgMonthlyLeadVolumelifetime", "l": "Avg monthly lead volume (lifetime)", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["50.0", "1.0", "10.0"], "pct": 86.6}, {"k": "LeadVolume", "l": "Lead volume", "t": "enum", "team": "CSM", "s": "usage", "h": false, "src": "Dashboard", "v": ["Medium", "High", "Low"], "pct": 38.3}, {"k": "OfMessagesSentl30", "l": "Messages sent (30 days)", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "1.0", "2.0"], "pct": 100}, {"k": "OfMeetingsl30", "l": "Meetings (30 days)", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "1.0", "2.0"], "pct": 100}, {"k": "OfActivitiesLoggedl30", "l": "Activities logged (30 days)", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "1.0", "2.0"], "pct": 100}, {"k": "AverageCsatLast60", "l": "Average CSAT (last 60 days)", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "5.0", "4.0"], "pct": 100}, {"k": "SmsPlanType", "l": "SMS plan", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["50.0", "1500.0", "18000.0"], "pct": 79.2}, {"k": "TotalSms", "l": "Total SMS", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "4.0", "2.0"], "pct": 79.2}, {"k": "TotalSmsSent", "l": "SMS sent", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "4.0", "2.0"], "pct": 79.2}, {"k": "TotalSmsInbound", "l": "SMS inbound", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "1.0", "2.0"], "pct": 79.2}, {"k": "OfSmsOverage", "l": "SMS overage", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "-50.0", "-1500.0"], "pct": 100}, {"k": "MmsPlanType", "l": "MMS plan", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["1000.0", "2000.0"], "pct": 6.2}, {"k": "TotalMmsInbound", "l": "MMS inbound", "t": "number", "team": "CSM", "s": "usage", "h": false, "src": "Usage", "v": ["0.0", "1.0", "4.0"], "pct": 6.2}, {"k": "PaidConsultations", "l": "Paid consultations", "t": "enum", "team": "CSM", "s": "usage", "h": false, "src": "Dashboard", "v": ["No", "Yes"], "pct": 25.9}, {"k": "TimeAndBilling", "l": "Time and billing", "t": "enum", "team": "CSM", "s": "usage", "h": false, "src": "Dashboard", "v": ["No", "False", "Yes"], "pct": 9.1}, {"k": "FirmId", "l": "Firm ID", "t": "number", "team": "Both", "s": "profile", "h": true, "src": "Salesforce", "v": [], "pct": 80}, {"k": "PrimaryPracticeArea", "l": "Primary practice area", "t": "enum", "team": "Both", "s": "profile", "h": false, "src": "Salesforce", "v": ["Estate Planning", "Family Law", "Personal Injury"], "pct": 76.5}, {"k": "NumberOfAttorneys", "l": "Number of attorneys", "t": "enum", "team": "Both", "s": "profile", "h": false, "src": "Salesforce", "v": ["1", "2-4", "5-9"], "pct": 35.3}, {"k": "Employees", "l": "Employees", "t": "number", "team": "Both", "s": "profile", "h": true, "src": "Salesforce", "v": ["5.0", "10.0", "3.0"], "pct": 56.4}, {"k": "FirmSize", "l": "Firm size", "t": "enum", "team": "Both", "s": "profile", "h": true, "src": "Dashboard", "v": ["5 to 9", "2 to 4", "10 to 19"], "pct": 56.8}, {"k": "Website", "l": "Website", "t": "link", "team": "Both", "s": "profile", "h": false, "src": "Salesforce", "v": [], "pct": 65.3}, {"k": "AccountPhone", "l": "Account phone", "t": "text", "team": "Both", "s": "profile", "h": false, "src": "Salesforce", "v": [], "pct": 76.3}, {"k": "Industry", "l": "Industry", "t": "enum", "team": "Both", "s": "profile", "h": false, "src": "Salesforce", "v": ["Legal Services", "Law Practice", "Consumer Services"], "pct": 51.2}, {"k": "NumberOfContactsWithRole", "l": "Contacts with a role", "t": "number", "team": "Both", "s": "profile", "h": false, "src": "Dashboard", "v": ["1.0", "0.0", "2.0"], "pct": 100}, {"k": "NumberOfPrimaryDecisionMakerContacts", "l": "Primary decision makers", "t": "number", "team": "Both", "s": "profile", "h": false, "src": "Dashboard", "v": ["1.0", "0.0", "2.0"], "pct": 100}, {"k": "OriginalOwner", "l": "Original owner", "t": "enum", "team": "Both", "s": "profile", "h": false, "src": "Dashboard", "v": [], "pct": 17.9}, {"k": "DateOwnerChanged", "l": "Date owner changed", "t": "date", "team": "Both", "s": "profile", "h": false, "src": "Dashboard", "v": ["2025-10-29", "2025-10-06", "2025-10-01"], "pct": 10.9}, {"k": "PracticeArea", "l": "Practice area", "t": "long", "team": "Both", "s": "profile", "h": true, "src": "Dashboard", "v": [], "pct": 55.7}, {"k": "OwnerId", "l": "Owner ID", "t": "number", "team": "Both", "s": "profile", "h": true, "src": "Dashboard", "v": [], "pct": 87.2}, {"k": "AccountManager", "l": "Account manager (old)", "t": "enum", "team": "Both", "s": "profile", "h": true, "src": "Dashboard", "v": [], "pct": 57.1}, {"k": "LastAmMeeting", "l": "Last owner meeting", "t": "date", "team": "Both", "s": "profile", "h": true, "src": "Dashboard", "v": ["2026-10-07", "2026-10-06", "2026-10-08"], "pct": 27.4}, {"k": "DifferenceBetweenLicenceCountAndEmployees", "l": "Difference between licence count and employees", "t": "number", "team": "CSM", "s": "profile", "h": false, "src": "Dashboard", "v": ["0.0", "-3.0", "2.0"], "pct": 100}, {"k": "AiCreditsUsedThisCycle", "l": "Merlin credits used this cycle", "t": "number", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["0.0", "1.0", "2.0"], "pct": 5.8}, {"k": "AiDemoScheduled", "l": "Merlin demo scheduled", "t": "bool", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 100}, {"k": "AiDemoDate", "l": "Merlin demo date", "t": "date", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["2026-01-23", "2026-02-06", "2026-02-17"], "pct": 3.3}, {"k": "AiDemoNotes", "l": "Merlin demo notes", "t": "long", "team": "CSM", "s": "ai", "h": true, "src": "Dashboard", "v": [], "pct": 1.5}, {"k": "AttendedAiOfficeHours", "l": "Attended Merlin office hours", "t": "bool", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 100}, {"k": "RunAiTrainingPlay", "l": "Merlin training requested", "t": "bool", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 100}, {"k": "PostDemoNextSteps", "l": "Post demo next steps", "t": "enum", "team": "CSM", "s": "ai", "h": true, "src": "Dashboard", "v": ["Interested", "Committed to Signing Up", "Not Interested"], "pct": 1.8}, {"k": "MerlinEngageNeedsFollowUp", "l": "Merlin engage needs follow up", "t": "bool", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["False"], "pct": 100}, {"k": "QualifyaiUser", "l": "QualifyAI user", "t": "bool", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 100}, {"k": "QualifyaiDemoOutcome", "l": "QualifyAI demo outcome", "t": "enum", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": ["Not interested", "Interested: send quote ne", "Signed Up"], "pct": 3.9}, {"k": "QualifyaiFollowUpDate", "l": "QualifyAI follow-up date", "t": "date", "team": "CSM", "s": "ai", "h": true, "src": "Dashboard", "v": ["2026-02-23", "2026-02-06", "2026-03-06"], "pct": 1.9}, {"k": "QualifyaiNotInterestedReason", "l": "QualifyAI not-interested reason", "t": "enum", "team": "CSM", "s": "ai", "h": true, "src": "Dashboard", "v": ["Other", "Feature Limitations", "Price"], "pct": 1.3}, {"k": "QualifyaiAdditionalNotes", "l": "QualifyAI notes", "t": "long", "team": "CSM", "s": "ai", "h": false, "src": "Dashboard", "v": [], "pct": 2.6}, {"k": "PartnerType", "l": "Partner type", "t": "enum", "team": "CSM", "s": "partner", "h": false, "src": "Salesforce", "v": ["Agency", "Affiliate", "Integration"], "pct": 6}, {"k": "ReferralPartner", "l": "Referral partner", "t": "enum", "team": "CSM", "s": "partner", "h": false, "src": "Salesforce", "v": [], "pct": 6.3}, {"k": "AgencyClientFirm", "l": "Agency client firm", "t": "bool", "team": "Both", "s": "partner", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 95.2}, {"k": "AgencyFirm", "l": "Agency firm", "t": "bool", "team": "Both", "s": "partner", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 87.2}, {"k": "Consultant", "l": "Consultant", "t": "bool", "team": "Both", "s": "partner", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 87.2}, {"k": "Consultant1Id", "l": "Consultant 1 ID", "t": "number", "team": "Both", "s": "partner", "h": true, "src": "Dashboard", "v": [], "pct": 2}, {"k": "Consultant2Id", "l": "Consultant 2 ID", "t": "number", "team": "Both", "s": "partner", "h": true, "src": "Dashboard", "v": [], "pct": 0.1}, {"k": "CancellationRequested", "l": "Cancellation requested", "t": "bool", "team": "CSM", "s": "churn", "h": false, "src": "Dashboard", "v": ["False", "True"], "pct": 100}, {"k": "ChurnDate", "l": "Churn date", "t": "date", "team": "CSM", "s": "churn", "h": false, "src": "Dashboard", "v": ["2022-08-31", "2027-01-18", "2026-10-29"], "pct": 6.4}, {"k": "ChurnCategory", "l": "Churn category", "t": "enum", "team": "CSM", "s": "churn", "h": false, "src": "Dashboard", "v": ["Competitor - More feature", "No Reason Provided - Non-", "No Reason Provided - Decl"], "pct": 3.9}, {"k": "ChurnReason", "l": "Churn reason", "t": "enum", "team": "CSM", "s": "churn", "h": false, "src": "Dashboard", "v": ["External Factors (uncontr", "Product-Related (controll", "Competition-Related (cont"], "pct": 2.5}, {"k": "ChurnReasonSubcategory", "l": "Churn reason subcategory", "t": "enum", "team": "CSM", "s": "churn", "h": true, "src": "Dashboard", "v": ["Vague details provided up", "Lack of engagement - cust", "Better features elsewhere"], "pct": 1.7}, {"k": "ChurnDetails", "l": "Churn details", "t": "long", "team": "CSM", "s": "churn", "h": false, "src": "Dashboard", "v": [], "pct": 4}, {"k": "AiBenefitsForTheirCustomers", "l": "Benefits for their clients", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiCurrentInitiativespublicOrImplied", "l": "Current initiatives", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiIcpSignals", "l": "ICP signals", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiIndustry", "l": "Industry", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiKeyCompetitors", "l": "Key competitors", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiPositioning", "l": "Positioning", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiProducts", "l": "Products", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiRecentNews", "l": "Recent news", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiServices", "l": "Services", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiStakeholderMappublic", "l": "Stakeholder map (public)", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiStrategicGoalsstatedOrInferred", "l": "Strategic goals", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiSuccessMetricscustomerRoiSignals", "l": "Success metrics / ROI signals", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiTargetPersonas", "l": "Target personas", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}, {"k": "AiToneAndCulture", "l": "Tone and culture", "t": "long", "team": "AE / Sales", "s": "research", "h": true, "src": "Dashboard", "v": [], "pct": 68.2}];
  const KEY_LAYOUT = 'cs-demo-field-layout', KEY_VALS = 'cs-demo-field-values', KEY_OPEN = 'cs-demo-field-open';
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const BY = Object.fromEntries(CATALOG.map((f) => [f.k, f]));
  const SECTIONS = [['onb', 'Onboarding'], ['bill', 'Contract & billing'], ['usage', 'Usage'], ['profile', 'Firm profile'], ['ai', 'Merlin & QualifyAI'],
    ['partner', 'Partners & referrals'], ['churn', 'Churn & cancellation']];   // the AI sales-research fields start hidden
  // Category values the audit cut short, written out in full.
  const ENUMS = {
    ChurnReasonSubcategory: ['Vague details provided', 'Lack of engagement', 'Better features elsewhere', 'Budget cuts'],
    ChurnCategory: ['Competitor - more features', 'No reason provided', 'Closed the practice', 'Price'],
    ChurnReason: ['External factors', 'Product-related', 'Competition-related', 'Service-related'],
    QualifyaiDemoOutcome: ['Not interested', 'Interested: send quote', 'Signed up'],
    OriginalOwner: ['Elliott Jones', 'Julio Ortiz', 'Jessie Hobbs', 'Callie Burns'], AccountManager: ['Elliott Jones', 'Julio Ortiz', 'Jessie Hobbs'],
    ReferralPartner: ['Test Referral Partner A', 'Test Referral Partner B', 'Test Bar Association'],
  };
  const TEXT = [
    [/Intake/, ['Web form → auto-text within 2 minutes → consult booked in the scheduler → intake questionnaire before the call.', 'Phone intake with the internal intake form; Google Ads leads auto-assigned to the intake team.']],
    [/Challenges/, ['Leads go cold over the weekend; no one owns follow-up.', 'Manual data entry between intake and the practice management system.']],
    [/TechStack/, ['Clio, Google Workspace, LawPay', 'MyCase, Microsoft 365', 'Practice Panther, Outlook']],
    [/SalesOnboardingNotes/, ['Wants the intake form live before their ad campaign starts.', 'Moving off a spreadsheet; expects a lot of hand-holding.']],
    [/Legacy/, ['On the 2023 legacy plan; price lock until the term ends.', 'Grandfathered SMS bundle.']],
    [/Churn/, ['Test data: said the team never adopted the automations.', 'Test data: practice merged with another firm.']],
    [/Additional/, ['First month free', '30-day complimentary service']],
    [/Notes/, ['Test data: prefers email over phone.', 'Test data: office manager runs day to day — loop her in.']],
    [/./, ['Test data: summary from public sources.', 'Test data: not found.']],
  ];
  const me = () => { const p = window.DEMO_PERSONA ? window.DEMO_PERSONA().name : 'Test Manager'; return p === 'Test Manager' ? 'Clare Struzzi' : p; };
  const isMgr = () => !window.DEMO_PERSONA || /manager/i.test(window.DEMO_PERSONA().name);
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (x) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) { /* */ } };

  /* ---------- layout ---------- */
  function defaultLayout() {
    return { sections: SECTIONS.map(([id, name]) => ({ id, name, fields: CATALOG.filter((f) => f.s === id && !f.h).map((f) => f.k) })),
      hidden: CATALOG.filter((f) => f.h).map((f) => f.k), by: 'Default layout', at: '' };
  }
  function cleanLayout(L) {
    const seen = new Set();
    L.sections.forEach((s) => { s.fields = s.fields.filter((k) => BY[k] && !seen.has(k) && seen.add(k)); });
    L.hidden = (L.hidden || []).filter((k) => BY[k] && !seen.has(k) && seen.add(k));
    CATALOG.forEach((f) => { if (!seen.has(f.k)) L.hidden.push(f.k); });   // a new field starts hidden
    return L;
  }
  let LAYOUT = cleanLayout(load(KEY_LAYOUT, null) || defaultLayout());
  let VALS = load(KEY_VALS, {});   // { firmId: { values: {k: v}, hist: [{k, from, to, by, at}] } }
  let OPEN = new Set(load(KEY_OPEN, []));

  /* ---------- values (made up, steady per firm) ---------- */
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const dayOff = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  function made(f, firm) {
    const r = hash(firm.id + f.k), pick = (a) => a[r % a.length];
    const slug = String(firm.name).replace(/^Test – /, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
    switch (f.k) {
      case 'FirmId': return firm.id;
      case 'AccountPhone': return `(555) ${String(100 + r % 900)}-${String(1000 + (r >> 4) % 9000)}`;
      case 'PrimaryPracticeArea': return firm.area;
      case 'StartingMrr': return firm.start;
      case 'CurrentMrrStartingMrr': return firm.mrr - firm.start;
      case 'AccountStatus': return firm.cancelled ? 'Churned' : 'Active';
      case 'ChargebeeAccountStatus': return firm.cancelled ? 'Cancelled' : firm.overdue ? 'Delinquent' : 'Active';
      case 'OnboardingStatus': return firm.onboarding ? firm.status : 'Complete';
      case 'NewOnboardingCall': return firm.onboarding ? firm.stage : 'Sixth Onboarding';
      case 'OnboardingCompletedDate': return firm.doneDay || '';
      case 'ImplementationSpecialist': return firm.im;
      case 'CancellationRequested': return firm.score > 90;
      case 'ChurnDate': return firm.cancelDay || '';
      case 'TechSavvyScore1Low5High': return String(1 + r % 5);
      case 'NewTimeInOnboarding': return firm.onbDays;
      case 'Website': return 'https://' + slug + '.example.com';
      case 'ImplementationType': return firm.mrr > 400 ? 'Premium Onboarding' : 'Basic Onboarding';
    }
    if (f.s === 'churn' && !firm.cancelled && f.t !== 'bool') return '';
    if (f.t === 'bool') return (r % 100) < (f.pct > 50 ? 12 : 30);
    if (f.t === 'date') return (r % 100) < 70 ? dayOff(/End|FollowUp/.test(f.k) ? -(r % 300) - 5 : (r % 600) + 2) : '';
    if (f.t === 'money') return 50 + r % 900;
    if (f.t === 'link') return (r % 100) < 75 ? `https://drive.google.com/drive/folders/test-${slug.slice(0, 12)}` : '';
    if (f.t === 'number') return f.v.length ? Number(pick(f.v)) + (r >> 3) % 5 : r % 50;
    if (f.t === 'long' || f.t === 'text') { if ((r % 100) > Math.max(30, f.pct || 0) + 20) return ''; const pool = TEXT.find(([re]) => re.test(f.k))[1]; return pick(pool); }
    const opts = ENUMS[f.k] || f.v;
    return opts.length && (r % 100) < Math.max(45, f.pct || 0) + 10 ? pick(opts) : '';
  }
  const rec = (id) => (VALS[id] = VALS[id] || { values: {}, hist: seedHist(id) });
  function seedHist(id) {
    const firm = window.DEMO_FIRM && window.DEMO_FIRM(id);
    if (!firm) return [];
    const h = [{ k: 'OnboardingStatus', from: 'Open', to: firm.onboarding ? firm.status : 'Complete', by: firm.onboarding ? 'Automation: Pre-Kickoff → Open' : firm.im, at: (firm.doneDay || dayOff(10)) + ' 09:12' }];
    if (!firm.onboarding) h.unshift({ k: 'TechSavvyScore1Low5High', from: '', to: String(1 + hash(id + 'TechSavvyScore1Low5High') % 5), by: firm.im, at: (firm.doneDay || dayOff(5)) + ' 16:40' });
    return h;
  }
  const valueOf = (f, firm) => { const v = (VALS[firm.id] || {}).values || {}; return f.k in v ? v[f.k] : made(f, firm); };
  const editable = (f) => f.src === 'Dashboard' || f.src === 'Salesforce';
  function show(f, v) {
    if (v === '' || v == null) return '<span class="fx-empty">—</span>';
    if (f.t === 'bool') return v === true || v === 'true' ? 'Yes' : 'No';
    if (f.t === 'money') return '$' + Number(v).toLocaleString();
    if (f.t === 'date') { const d = new Date(String(v).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? e(v) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
    if (f.t === 'link') return `<a href="${e(v)}" target="_blank" rel="noopener">Open ↗</a>`;
    return e(v);
  }

  /* ---------- card ---------- */
  const S = { firm: null, q: '', edit: null, layoutMode: false, draft: null, showHidden: false, changes: false };
  function html() {
    const firm = S.firm, L = S.layoutMode ? S.draft : LAYOUT, q = S.q.trim().toLowerCase();
    const hist = rec(firm.id).hist;
    const total = L.sections.reduce((n, s) => n + s.fields.length, 0);
    const match = (f) => !q || f.l.toLowerCase().includes(q) || String(valueOf(f, firm)).toLowerCase().includes(q);
    const row = (k, si) => {
      const f = BY[k], v = valueOf(f, firm), changed = hist.some((h) => h.k === k);
      if (S.layoutMode) {
        return `<div class="fx-row lay"><span class="fx-l">${e(f.l)}<small>${e(f.team)}${f.src !== 'Dashboard' ? ' · ' + e(f.src) : ''}</small></span>
          <span class="fx-lay-acts"><button type="button" class="fx-mini" data-up="${k}" title="Move up" aria-label="Move ${e(f.l)} up">↑</button><button type="button" class="fx-mini" data-down="${k}" title="Move down" aria-label="Move ${e(f.l)} down">↓</button>
          <select data-move="${k}" aria-label="Section for ${e(f.l)}">${L.sections.map((s) => `<option value="${e(s.id)}"${s.id === si ? ' selected' : ''}>${e(s.name)}</option>`).join('')}<option value="__hidden"${si === '__hidden' ? ' selected' : ''}>Hidden</option></select></span></div>`;
      }
      if (S.edit === k) {
        const ctl = f.t === 'bool' ? `<select data-val><option value="true"${v === true ? ' selected' : ''}>Yes</option><option value="false"${v !== true ? ' selected' : ''}>No</option></select>`
          : f.t === 'enum' ? `<select data-val><option value=""></option>${[...new Set((ENUMS[f.k] || f.v).concat(v ? [v] : []))].map((o) => `<option${o === v ? ' selected' : ''}>${e(o)}</option>`).join('')}</select>`
            : f.t === 'long' ? `<textarea data-val rows="3">${e(v)}</textarea>`
              : `<input data-val type="${f.t === 'date' ? 'date' : f.t === 'number' || f.t === 'money' ? 'number' : 'text'}" value="${e(f.t === 'date' ? String(v).slice(0, 10) : v)}">`;
        return `<div class="fx-row editing"><span class="fx-l">${e(f.l)}</span><span class="fx-v">${ctl}<span class="fx-edit-acts"><button type="button" class="au-btn sm primary" data-save="${k}">Save</button><button type="button" class="au-btn sm" data-cancel>Cancel</button></span></span></div>`;
      }
      return `<div class="fx-row${f.t === 'long' ? ' wide' : ''}"><span class="fx-l">${e(f.l)}${changed ? `<button type="button" class="fx-hist" data-hist="${k}" title="Change history" aria-label="Change history for ${e(f.l)}">🕑</button>` : ''}</span>
        <span class="fx-v">${editable(f) ? `<button type="button" class="fx-val" data-edit="${k}" title="Click to edit">${show(f, v)}</button>` : `${show(f, v)}<small class="fx-src" title="Synced from ${e(f.src)}; edit it there">${e(f.src)}</small>`}</span></div>`;
    };
    const filledOf = (s) => s.fields.filter((k) => { const v = valueOf(BY[k], firm); return v !== '' && v != null; }).length;
    const section = (s, i) => {
      const fields = s.fields.filter((k) => S.layoutMode || match(BY[k]));
      if (!S.layoutMode && q && !fields.length) return '';
      const open = S.layoutMode || !!q || OPEN.has(s.id);
      const head = S.layoutMode
        ? `<div class="fx-sh lay"><input data-rename="${e(s.id)}" value="${e(s.name)}" aria-label="Section name"><span class="fx-lay-acts"><button type="button" class="fx-mini" data-sup="${e(s.id)}" ${i ? '' : 'disabled'} aria-label="Move section up">↑</button><button type="button" class="fx-mini" data-sdown="${e(s.id)}" ${i < L.sections.length - 1 ? '' : 'disabled'} aria-label="Move section down">↓</button><button type="button" class="fx-mini" data-sdel="${e(s.id)}" title="${s.fields.length ? 'Move its fields out first' : 'Remove section'}" ${s.fields.length ? 'disabled' : ''} aria-label="Remove section">🗑</button></span></div>`
        : `<button type="button" class="fx-sh" data-toggle="${e(s.id)}" aria-expanded="${open}"><span class="fx-chev">${open ? '▾' : '▸'}</span><b>${e(s.name)}</b><span class="fx-count">${filledOf(s)} of ${s.fields.length} filled</span></button>`;
      return `<section class="fx-sec${open ? ' open' : ''}">${head}${open ? `<div class="fx-grid">${fields.map((k) => row(k, s.id)).join('') || '<div class="fx-none">No fields here yet.</div>'}</div>` : ''}</section>`;
    };
    const hiddenSec = (S.layoutMode || S.showHidden) ? `<section class="fx-sec open fx-hidden"><div class="fx-sh static"><b>${S.layoutMode ? 'Hidden fields' : 'Hidden fields'}</b><span class="fx-count">${L.hidden.length} · not shown on the firm page, kept for the record</span></div>
        <div class="fx-grid">${L.hidden.filter((k) => S.layoutMode || match(BY[k])).map((k) => row(k, '__hidden')).join('')}</div></section>` : '';
    const changes = S.changes ? `<div class="fx-changes"><b>Recent changes</b>${hist.length ? `<ul>${hist.slice(0, 12).map((h) => `<li><b>${e((BY[h.k] || {}).l || h.k)}</b>: ${h.from === '' || h.from == null ? '<i>empty</i>' : e(String(h.from))} → ${e(String(h.to))}<small>${e(h.by)} · ${e(h.at)}</small></li>`).join('')}</ul>` : '<p class="fx-none">No changes yet.</p>'}</div>` : '';
    return `<div class="fx-head"><h4>📇 Account details <span class="muted">${total} fields · ${L.sections.length} sections</span></h4>
        <div class="fx-tools">${S.layoutMode ? `<button type="button" class="au-btn sm" data-addsec>＋ Section</button><button type="button" class="au-btn sm" data-resetlay>Reset to default</button><button type="button" class="au-btn sm" data-laycancel>Cancel</button><button type="button" class="au-btn sm primary" data-laysave>Save layout</button>`
          : `<input type="search" data-q placeholder="Find a field" value="${e(S.q)}" aria-label="Find a field"><button type="button" class="au-btn sm" data-all>${L.sections.every((s) => OPEN.has(s.id)) ? 'Collapse all' : 'Expand all'}</button><button type="button" class="au-btn sm${S.changes ? ' on' : ''}" data-changes>🕑 Changes <span class="muted">${hist.length}</span></button>${isMgr() ? '<button type="button" class="au-btn sm" data-layout>✏️ Edit layout</button>' : ''}`}</div></div>
      ${S.layoutMode ? `<p class="fx-laynote">Move fields between sections with the menus, reorder with the arrows, rename sections in place. Changes apply to everyone's firm page. ${LAYOUT.at ? `Last saved by ${e(LAYOUT.by)} · ${e(LAYOUT.at)}.` : ''}</p>` : ''}
      ${changes}
      ${L.sections.map(section).join('')}${hiddenSec}
      ${S.layoutMode ? '' : `<button type="button" class="fx-showhidden" data-showhidden>${S.showHidden ? 'Hide' : 'Show'} ${L.hidden.length} hidden fields</button>`}`;
  }
  function draw() { const c = document.getElementById('pfFields'); if (c) c.innerHTML = html(); }

  function onClick(ev) {
    const q = (s) => ev.target.closest(s); let el;
    const L = S.draft;
    if ((el = q('[data-toggle]'))) { const id = el.dataset.toggle; OPEN.has(id) ? OPEN.delete(id) : OPEN.add(id); store(KEY_OPEN, [...OPEN]); draw(); return; }
    if (q('[data-all]')) { const all = LAYOUT.sections.every((s) => OPEN.has(s.id)); OPEN = new Set(all ? [] : LAYOUT.sections.map((s) => s.id)); store(KEY_OPEN, [...OPEN]); draw(); return; }
    if (q('[data-changes]')) { S.changes = !S.changes; draw(); return; }
    if (q('[data-showhidden]')) { S.showHidden = !S.showHidden; draw(); return; }
    if ((el = q('[data-hist]'))) { S.changes = true; draw(); return; }
    if ((el = q('[data-edit]'))) { S.edit = el.dataset.edit; draw(); document.querySelector('#pfFields [data-val]')?.focus(); return; }
    if (q('[data-cancel]')) { S.edit = null; draw(); return; }
    if ((el = q('[data-save]'))) { saveVal(el.dataset.save); return; }
    if (q('[data-layout]')) { S.layoutMode = true; S.draft = JSON.parse(JSON.stringify(LAYOUT)); S.edit = null; draw(); return; }
    if (q('[data-laycancel]')) { S.layoutMode = false; S.draft = null; draw(); return; }
    if (q('[data-resetlay]')) { S.draft = defaultLayout(); draw(); return; }
    if (q('[data-laysave]')) { S.draft.by = me(); S.draft.at = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); LAYOUT = cleanLayout(S.draft); store(KEY_LAYOUT, LAYOUT); S.layoutMode = false; S.draft = null; draw(); return; }
    if (q('[data-addsec]')) { L.sections.push({ id: 's' + Date.now(), name: 'New section', fields: [] }); draw(); const ins = document.querySelectorAll('#pfFields [data-rename]'); ins[ins.length - 1]?.select(); return; }
    const swap = (arr, i, j) => { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
    if ((el = q('[data-sup]')) || (el = q('[data-sdown]'))) { const id = el.dataset.sup || el.dataset.sdown, i = L.sections.findIndex((s) => s.id === id); swap(L.sections, i, i + (el.dataset.sup ? -1 : 1)); draw(); return; }
    if ((el = q('[data-sdel]'))) { L.sections = L.sections.filter((s) => s.id !== el.dataset.sdel || s.fields.length); draw(); return; }
    if ((el = q('[data-up]')) || (el = q('[data-down]'))) {
      const k = el.dataset.up || el.dataset.down, list = L.sections.map((s) => s.fields).concat([L.hidden]).find((a) => a.includes(k));
      const i = list.indexOf(k); swap(list, i, i + (el.dataset.up ? -1 : 1)); draw(); return;
    }
  }
  function onChange(ev) {
    const t = ev.target;
    if (t.matches('[data-move]')) {
      const L = S.draft, k = t.dataset.move;
      L.sections.forEach((s) => { s.fields = s.fields.filter((x) => x !== k); }); L.hidden = L.hidden.filter((x) => x !== k);
      if (t.value === '__hidden') L.hidden.unshift(k); else L.sections.find((s) => s.id === t.value).fields.push(k);
      draw();
    }
  }
  function onInput(ev) {
    const t = ev.target;
    if (t.matches('[data-rename]')) { const s = S.draft.sections.find((x) => x.id === t.dataset.rename); if (s) s.name = t.value; return; }
    if (t.matches('[data-q]')) { S.q = t.value; const pos = t.selectionStart; draw(); const i = document.querySelector('#pfFields [data-q]'); i.focus(); i.setSelectionRange(pos, pos); }
  }
  function onKey(ev) {
    if (ev.key === 'Escape' && S.edit) { S.edit = null; draw(); }
    if (ev.key === 'Enter' && S.edit && ev.target.matches('input[data-val]')) { ev.preventDefault(); saveVal(S.edit); }
  }
  function saveVal(k) {
    const f = BY[k], el = document.querySelector('#pfFields [data-val]');
    let v = el ? el.value : '';
    if (f.t === 'bool') v = v === 'true';
    if ((f.t === 'number' || f.t === 'money') && v !== '') v = Number(v);
    const r = rec(S.firm.id), from = valueOf(f, S.firm);
    if (String(from) !== String(v)) {
      r.values[k] = v;
      r.hist.unshift({ k, from: f.t === 'bool' ? (from ? 'Yes' : 'No') : from, to: f.t === 'bool' ? (v ? 'Yes' : 'No') : v, by: me(), at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
      store(KEY_VALS, VALS);
    }
    S.edit = null; draw();
  }

  /* ---------- mount: above the firm's bugs & feature requests ---------- */
  function check() {
    const prod = document.getElementById('pfProduct');
    if (!prod || document.getElementById('pfFields')) return;
    const firm = window.DEMO_FIRM && window.DEMO_FIRM(prod.dataset.firm);
    if (!firm) return;
    Object.assign(S, { firm, q: '', edit: null, layoutMode: false, draft: null, showHidden: false, changes: false });
    const card = document.createElement('div');
    card.className = 'pf-card fx-card'; card.id = 'pfFields';
    prod.before(card);
    card.addEventListener('click', onClick); card.addEventListener('change', onChange); card.addEventListener('input', onInput); card.addEventListener('keydown', onKey);
    draw();
  }
  const obs = new MutationObserver(() => setTimeout(check, 0));
  const start = () => { const h = document.getElementById('profile'); if (h) obs.observe(h, { childList: true, subtree: true }); else setTimeout(start, 500); };
  start();
  // Managers changing "View as" mid-page: redraw so the Edit layout button follows.
  let lastP = '';
  setInterval(() => { const p = window.DEMO_PERSONA ? window.DEMO_PERSONA().name : ''; if (p !== lastP) { lastP = p; if (!isMgr()) { S.layoutMode = false; S.draft = null; } draw(); } }, 900);
})();
