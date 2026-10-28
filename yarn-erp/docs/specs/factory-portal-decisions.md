# Factory Portal: answers to the spec's open items (29 Oct 2026)

These are the user's answers to section 11 of `factory-portal-spec.txt`. Together the two files are the binding spec.

1. **Where it is built:** rework the existing Yarnflow ERP branch (`feat/erp-workflows`) into the Factory Portal. Reuse the code it already has where it matches the spec, and remove what the spec excludes: supplier and buyer portal *screens*, production planning, free-form chat, any role beyond the six.
2. **Invoice fields:** currency PKR, tax 18% GST on the subtotal, invoice numbers `INV-YYYY-NNNN`. The sequence resets each calendar year. All three are admin-editable settings.
3. **Supplier/Buyer portal integration:** API endpoints. The factory exposes authenticated intake endpoints (supplier registrations, supplier bids, buyer registrations, buyer RFQs, buyer acceptance of quotations) and outbound read endpoints (purchase RFQs, bid results, quotations, invoices). There are no portal screens.
4. **User and role management:** in admin scope. Admin creates users, assigns one of the six roles and deactivates accounts.
5. **PO re-approval (4.3 point 4):** keep it.
6. **Every [ASSUMPTION] item:** implement as written.
