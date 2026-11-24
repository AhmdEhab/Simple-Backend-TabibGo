/**
 * Document Requirements Configuration
 * Distinguishes legally mandatory documents from TabibiGo internal verification requirements.
 * Egyptian Healthcare Practice Context:
 * - Nurses: Regulated under Ministry of Health and Population (MOHP) License & Egyptian Syndicate of Nursing.
 * - Physical Therapists: Regulated under MOHP License (General Administration of Medical Licensing) & General Syndicate of Physical Therapy.
 * - Both professions require identity verification (National ID) and clinical safety certification (BLS) under TabibiGo platform verification policy.
 */

const REQUIREMENT_CATEGORIES = {
  LEGAL_MANDATORY: "legal_mandatory",     // Required by law to practice profession in Egypt
  PLATFORM_POLICY: "platform_policy"      // Required by TabibiGo verification and quality assurance policy
};

const PATIENT_DOCUMENTS_CONFIG = [
  {
    type: "profile_photo",
    label: "Profile Photo",
    category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
    required: true,
    allowMultiple: false,
    allowedMime: ["image/jpeg", "image/png", "image/webp"],
    description: "Clear profile picture for patient identification."
  },
  {
    type: "national_id_front",
    label: "National ID – Front",
    category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
    required: true,
    allowMultiple: false,
    allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    description: "Egyptian National ID Card (Front)."
  },
  {
    type: "national_id_back",
    label: "National ID – Back",
    category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
    required: true,
    allowMultiple: false,
    allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    description: "Egyptian National ID Card (Back)."
  },
  {
    type: "proof_of_address",
    label: "Proof of Address",
    category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
    required: true,
    allowMultiple: false,
    allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    description: "Recent utility bill, lease contract, or national ID back showing residence."
  }
];

const PROFESSION_DOCUMENT_CONFIGS = {
  "Nurse": [
    {
      type: "nursing_graduation_certificate",
      legacyType: "graduation_certificate",
      label: "Nursing Graduation Certificate",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "Accredited University / Technical Institute of Nursing",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Official Bachelor of Nursing or Nursing Institute graduation certificate according to professional qualification."
    },
    {
      type: "nursing_practice_license",
      legacyType: "professional_license",
      label: "Valid Nursing Professional Practice License",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "Egyptian Ministry of Health and Population (MOHP)",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "MOHP License to practice nursing in the Arab Republic of Egypt."
    },
    {
      type: "nursing_syndicate_card",
      legacyType: "syndicate_card",
      label: "Nursing Syndicate Membership Card / Proof of Registration",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "Egyptian Syndicate of Nursing",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid membership card or official membership evidence from the Egyptian Nursing Syndicate, where applicable."
    },
    {
      type: "nursing_internship_certificate",
      legacyType: "internship_certificate",
      label: "Nursing Internship / Clinical Training Certificate",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "Accredited Hospital / Faculty of Nursing",
      required: false, // Required according to qualification pathway
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Internship or clinical training completion certificate according to qualification pathway."
    },
    {
      type: "bls_certificate",
      legacyType: "bls_certificate",
      label: "Basic Life Support (BLS) Certificate",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Accredited Provider (e.g. AHA, ERC, Egyptian Resuscitation Council)",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid BLS/CPR certification as required by TabibiGo verification policy."
    },
    {
      type: "national_id_front",
      legacyType: "national_id_front",
      label: "National ID – Front",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Civil Registry of Egypt",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid Egyptian National ID front side for identity verification."
    },
    {
      type: "national_id_back",
      legacyType: "national_id_back",
      label: "National ID – Back",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Civil Registry of Egypt",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid Egyptian National ID back side."
    },
    {
      type: "experience_certificate",
      label: "Experience Certificates",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Employing Hospitals / Medical Centers",
      required: false,
      allowMultiple: true,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Work experience and previous clinical employment certificates (multiple files supported)."
    },
    {
      type: "additional_training_certificate",
      label: "Additional Training & Course Certificates",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Accredited Medical Training Entities",
      required: false,
      allowMultiple: true,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Specialized nursing training, infection control, ICU, pediatric or course certificates (multiple files supported)."
    }
  ],

  "Physical Therapist": [
    {
      type: "pt_graduation_certificate",
      legacyType: "graduation_certificate",
      label: "Physical Therapy Bachelor's Degree Certificate",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "Accredited Faculty of Physical Therapy",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Official Bachelor of Physical Therapy degree certificate."
    },
    {
      type: "pt_internship_certificate",
      legacyType: "internship_certificate",
      label: "Internship Certificate",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "University Hospitals / Ministry of Health Hospitals",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Official certificate of completing the mandatory physical therapy internship year."
    },
    {
      type: "pt_practice_license",
      legacyType: "professional_license",
      label: "Ministry of Health Professional Practice License",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "Egyptian Ministry of Health and Population (MOHP)",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "MOHP License to practice physical therapy in Egypt."
    },
    {
      type: "pt_syndicate_card",
      legacyType: "syndicate_card",
      label: "Physical Therapy Syndicate Membership Card / Proof of Registration",
      category: REQUIREMENT_CATEGORIES.LEGAL_MANDATORY,
      authority: "General Syndicate of Physical Therapy",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid syndicate card or proof of registration from the General Syndicate of Physical Therapy."
    },
    {
      type: "bls_certificate",
      legacyType: "bls_certificate",
      label: "Basic Life Support (BLS) Certificate",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Accredited Provider (e.g. AHA, ERC, Egyptian Resuscitation Council)",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid BLS certification according to TabibiGo verification policy."
    },
    {
      type: "national_id_front",
      legacyType: "national_id_front",
      label: "National ID – Front",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Civil Registry of Egypt",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid Egyptian National ID front side for identity verification."
    },
    {
      type: "national_id_back",
      legacyType: "national_id_back",
      label: "National ID – Back",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Civil Registry of Egypt",
      required: true,
      allowMultiple: false,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Valid Egyptian National ID back side."
    },
    {
      type: "experience_certificate",
      label: "Experience Certificates",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Physical Therapy Centers / Hospitals",
      required: false,
      allowMultiple: true,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Work experience and clinical rehabilitation center certificates (multiple files supported)."
    },
    {
      type: "postgraduate_specialization_certificate",
      label: "Postgraduate & Specialization Certificates",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Accredited Universities / Professional Boards",
      required: false,
      allowMultiple: true,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Diplomas, Master's degrees, or clinical specialization credentials (multiple files supported)."
    },
    {
      type: "additional_training_certificate",
      label: "Additional Training Certificates",
      category: REQUIREMENT_CATEGORIES.PLATFORM_POLICY,
      authority: "Accredited PT Training Providers",
      required: false,
      allowMultiple: true,
      allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      description: "Dry needling, manual therapy, sports rehabilitation, or pediatric therapy courses (multiple files supported)."
    }
  ]
};

// Flatten all valid document type names for Mongoose schema validation
const ALL_DOCUMENT_TYPES = [
  ...PATIENT_DOCUMENTS_CONFIG.map((d) => d.type),
  // General/legacy types
  "graduation_certificate",
  "professional_license",
  "syndicate_card",
  "bls_certificate",
  "internship_certificate",
  // Nurse specific types
  "nursing_graduation_certificate",
  "nursing_practice_license",
  "nursing_syndicate_card",
  "nursing_internship_certificate",
  // Physical Therapist specific types
  "pt_graduation_certificate",
  "pt_internship_certificate",
  "pt_practice_license",
  "pt_syndicate_card",
  // Multi-file types
  "experience_certificate",
  "postgraduate_specialization_certificate",
  "additional_training_certificate"
];

module.exports = {
  REQUIREMENT_CATEGORIES,
  PATIENT_DOCUMENTS_CONFIG,
  PROFESSION_DOCUMENT_CONFIGS,
  ALL_DOCUMENT_TYPES
};
