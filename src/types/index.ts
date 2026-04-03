export interface InsuranceCompany {
  id: string;
  name: string;
  availity_carrier_id: string;
  is_active: boolean;
  created_at: string;
  created_by: string;
}

export interface DentalPlan {
  id: string;
  insurance_company_id: string;
  plan_name: string;
  plan_id: string;
  coverage_type: 'basic' | 'standard' | 'comprehensive';
  deductible: number;
  annual_max: number;
  preventive_coverage: number;
  basic_coverage: number;
  major_coverage: number;
  is_active: boolean;
  created_at: string;
  created_by: string;
  insurance_company?: Pick<InsuranceCompany, 'name' | 'availity_carrier_id'>;
}

export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  member_id: string;
  group_number?: string;
  insurance_company_id: string;
  dental_plan_id?: string;
  ssn_last4?: string;
  email?: string;
  phone?: string;
  created_at: string;
  created_by: string;
  insurance_company?: InsuranceCompany | null;
  dental_plan?: DentalPlan | null;
}

export interface Preauthorization {
  id: string;
  patient_id: string;
  dental_plan_id?: string;
  procedure_code: string;
  procedure_description: string;
  tooth_number?: string;
  estimated_cost?: number;
  status: 'pending' | 'approved' | 'denied' | 'more_info_needed';
  availity_reference_id?: string;
  response_data?: unknown;
  submitted_by: string;
  created_at: string;
  updated_at?: string;
  patient?: Pick<Patient, 'first_name' | 'last_name' | 'member_id'>;
}
