import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pytest
from datetime import date
from cob_engine import birthday_rule, classify_payer, order_coverages, apply_msp_rules, parse_date


class TestBirthdayRule:
    def test_earlier_birthday_wins(self):
        assert birthday_rule(date(1970, 1, 15), date(1972, 3, 20)) == 0

    def test_later_birthday_loses(self):
        assert birthday_rule(date(1970, 9, 1), date(1968, 3, 15)) == 1

    def test_tiebreak_same_month_day_older_wins(self):
        """Same month+day: older subscriber (earlier birth year) is primary."""
        assert birthday_rule(date(1965, 6, 15), date(1970, 6, 15)) == 0

    def test_tiebreak_same_month_day_younger_loses(self):
        assert birthday_rule(date(1975, 4, 10), date(1960, 4, 10)) == 1

    def test_missing_dob1_returns_secondary(self):
        assert birthday_rule(None, date(1970, 1, 1)) == 1

    def test_missing_dob2_returns_primary(self):
        assert birthday_rule(date(1970, 1, 1), None) == 0


class TestClassifyPayer:
    def test_medicare(self):
        assert classify_payer("Medicare Part A/B") == "medicare"
        assert classify_payer("MEDICARE ADVANTAGE") == "medicare"

    def test_medicaid(self):
        assert classify_payer("Medicaid") == "medicaid"
        assert classify_payer("Medi-Cal") == "medicaid"
        assert classify_payer("AHCCCS Arizona") == "medicaid"

    def test_tricare(self):
        assert classify_payer("TRICARE Prime") == "tricare"
        assert classify_payer("CHAMPVA") == "tricare"

    def test_group(self):
        assert classify_payer("Blue Cross PPO") == "group"
        assert classify_payer("Aetna HMO") == "group"

    def test_dental(self):
        assert classify_payer("Delta Dental PPO") == "dental"


class TestMSPRules:
    def _cov(self, payer_name, **kwargs):
        return {"payer_name": payer_name, **kwargs}

    def test_esrd_30_months_or_less_group_is_primary(self):
        """MSP: ESRD within first 30 months — group plan is primary."""
        coverages = [
            self._cov("Medicare Part A/B"),
            self._cov("Aetna Group Plan", esrd=True, esrd_months=18),
        ]
        ordered = apply_msp_rules(55, coverages)
        assert classify_payer(ordered[0]["payer_name"]) == "group"
        assert classify_payer(ordered[1]["payer_name"]) == "medicare"

    def test_esrd_over_30_months_medicare_is_primary(self):
        """MSP: After 30 months of ESRD, Medicare becomes primary."""
        coverages = [
            self._cov("Medicare Part A/B"),
            self._cov("Aetna Group Plan", esrd=True, esrd_months=36),
        ]
        ordered = apply_msp_rules(55, coverages)
        assert classify_payer(ordered[0]["payer_name"]) == "medicare"

    def test_disability_under_65_group_is_primary(self):
        """MSP: Disabled patient under 65 — group plan is primary."""
        coverages = [
            self._cov("Medicare Part A/B"),
            self._cov("Cigna Group Plan", disability=True),
        ]
        ordered = apply_msp_rules(58, coverages)
        assert classify_payer(ordered[0]["payer_name"]) == "group"
        assert classify_payer(ordered[1]["payer_name"]) == "medicare"

    def test_age_65_plus_group_is_primary(self):
        """MSP: Active employee 65+ — group plan is primary."""
        coverages = [
            self._cov("Medicare Part A/B"),
            self._cov("Blue Cross Group Plan"),
        ]
        ordered = apply_msp_rules(68, coverages)
        assert classify_payer(ordered[0]["payer_name"]) == "group"
        assert classify_payer(ordered[1]["payer_name"]) == "medicare"

    def test_medicaid_always_last(self):
        """Federal law: Medicaid is always payer of last resort."""
        coverages = [
            self._cov("Medicaid"),
            self._cov("Blue Cross PPO"),
            self._cov("Medicare Part A/B"),
        ]
        ordered = apply_msp_rules(70, coverages)
        assert classify_payer(ordered[-1]["payer_name"]) == "medicaid"

    def test_no_medicare_passthrough(self):
        """Non-Medicare patients unaffected by MSP rules."""
        coverages = [
            self._cov("Blue Cross PPO"),
            self._cov("Aetna HMO"),
        ]
        ordered = apply_msp_rules(45, coverages)
        assert len(ordered) == 2
        assert all(classify_payer(c["payer_name"]) == "group" for c in ordered)


class TestOrderCoverages:
    def _patient(self, dob="1955-03-15", state="CA"):
        return {"first_name": "John", "last_name": "Smith", "dob": dob, "state": state}

    def test_single_coverage_no_reorder(self):
        patient = self._patient()
        coverages = [{"payer_name": "Blue Cross PPO", "subscriber_dob": "1955-03-15"}]
        ordered = order_coverages(patient, coverages)
        assert len(ordered) == 1
        assert ordered[0]["cob_order"] == 1

    def test_birthday_rule_two_group_plans(self):
        """Two group plans — subscriber with earlier birthday is primary."""
        patient = self._patient(dob="1960-01-01")
        coverages = [
            {"payer_name": "Aetna Group", "subscriber_dob": "1965-09-01"},
            {"payer_name": "Blue Cross Group", "subscriber_dob": "1962-03-15"},
        ]
        ordered = order_coverages(patient, coverages)
        assert ordered[0]["payer_name"] == "Blue Cross Group"
        assert ordered[0]["cob_order"] == 1
        assert ordered[1]["cob_order"] == 2

    def test_medicaid_last_in_full_order(self):
        """Full ordering: Group > Medicare > Medicaid."""
        patient = self._patient(dob="1950-01-01")
        coverages = [
            {"payer_name": "Medicaid", "subscriber_dob": "1950-01-01"},
            {"payer_name": "Medicare Part A/B", "subscriber_dob": "1950-01-01"},
            {"payer_name": "Blue Cross Group", "subscriber_dob": "1950-01-01"},
        ]
        ordered = order_coverages(patient, coverages)
        payer_types = [classify_payer(c["payer_name"]) for c in ordered]
        assert payer_types[-1] == "medicaid"
        assert payer_types[0] == "group"

    def test_cob_order_and_reason_assigned(self):
        """Every coverage must have cob_order and cob_reason."""
        patient = self._patient()
        coverages = [
            {"payer_name": "Blue Cross PPO", "subscriber_dob": "1960-01-01"},
            {"payer_name": "Aetna HMO", "subscriber_dob": "1965-06-01"},
        ]
        ordered = order_coverages(patient, coverages)
        for i, cov in enumerate(ordered):
            assert cov["cob_order"] == i + 1
            assert "cob_reason" in cov

    def test_empty_coverages_returns_empty(self):
        assert order_coverages(self._patient(), []) == []


class TestParseDate:
    def test_iso_format(self):
        assert parse_date("1970-01-15") == date(1970, 1, 15)

    def test_us_format(self):
        assert parse_date("01/15/1970") == date(1970, 1, 15)

    def test_none_returns_none(self):
        assert parse_date(None) is None

    def test_empty_returns_none(self):
        assert parse_date("") is None

    def test_date_object_passthrough(self):
        d = date(1970, 1, 15)
        assert parse_date(d) == d
