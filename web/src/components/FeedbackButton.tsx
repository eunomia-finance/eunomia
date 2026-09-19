import type { CSSProperties } from "react";

// Feedback funnels to ONE channel — the Google Form (name + email + wallet + rating) — so
// every response lands in a single sheet (risein Level 5 evidence) instead of splitting
// between Supabase and the form. The in-app Supabase modal was retired and removed;
// the existing Supabase `feedback` rows are kept as early feedback.
const FEEDBACK_FORM_URL = "https://forms.gle/7gzJWwte52SmbXei7";

// A real anchor, not window.open: browsers block scripted popups even from a click
// handler (Chrome's default "pop-ups and redirects: blocked"), so window.open returned
// null and the button silently did nothing. Anchor navigation is never popup-blocked.
export default function FeedbackButton() {
  return (
    <a className="feedback-fab" style={fab} href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer">
      Share feedback
    </a>
  );
}

// Colours live in index.css under .feedback-fab, not here: this button is rendered outside
// both .lp and .shell, so it cannot read either one's tokens — and an inline colour would win
// over the stylesheet anyway, which is how it stayed on the old dark-and-yellow palette after
// everything around it moved.
// Only geometry stays inline. Anything the shell needs to override on a phone — size,
// radius, and the type itself — lives in the stylesheet, because an inline value wins over
// a class and that is exactly how this button kept resisting every change made around it.
// Below the bottom sheet (backdrop 1300), above the tab bar (1000) and the topbar's menus
// (1200): at 1500 it floated over an open sheet and covered the text it carries — on a phone,
// part of the bank instructions.
const fab: CSSProperties = {
  position: "fixed", right: 18, bottom: 18, zIndex: 1250,
  cursor: "pointer", textDecoration: "none", fontFamily: "inherit",
};
