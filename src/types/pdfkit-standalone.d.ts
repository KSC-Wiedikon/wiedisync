// pdfkit's self-contained browser bundle ships no types; we use it through casts
// in MemberPayoutQrBill (swissqrbill draws onto the pdfkit doc). Ambient-declare it
// so the dynamic import type-checks as `any`.
declare module 'pdfkit/js/pdfkit.standalone.js'
