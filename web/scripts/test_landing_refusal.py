import re
import unittest
from pathlib import Path


class LandingClaimsTest(unittest.TestCase):
    def test_refusal_hash_and_privacy_claim_match_available_features(self):
        landing = Path(__file__).parents[1] / "src/components/landing"
        proof = (landing / "Proof.tsx").read_text(encoding="utf-8")
        match = re.search(r'const BLOCKED_TX = "([^"]+)";', proof)
        self.assertIsNotNone(match)
        tx_hash = match.group(1)
        self.assertRegex(tx_hash, r"^[0-9a-f]{64}$")
        self.assertEqual(tx_hash, "d48e7ff8fdc0f93a5972d0d783e3861f29a3baebb96c5f82b2c9ff545e00f3b5")

        privacy = (landing / "Privacy.tsx").read_text(encoding="utf-8")
        self.assertIn('if (__EUNOMIA_NETWORK__ !== "testnet") return null;', privacy)


if __name__ == "__main__":
    unittest.main()
