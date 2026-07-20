# Permanent instructions for development agents

1. Read README.md and the documents under docs/ before changing source code.
2. Do not introduce corporate source, customer data, credentials, tokens,
   internal URLs, certificates, production data, or unconfirmed system names.
3. Do not expand scope without recording the decision in docs/DECISIONS.md.
4. Do not silently change approved data contracts, tool contracts or state
   semantics.
5. Update documentation whenever an architectural, operational or data-model
   change is made.
6. Run npm.cmd run typecheck, npm.cmd run lint and npm.cmd run test; run
   npm.cmd run build when changing production TypeScript.
7. Clearly distinguish verified facts, hypotheses and approved decisions in
   code comments and documentation.
8. Do not implement external integrations until their contract has been
   confirmed and documented.
9. Keep all filesystem writes inside the explicitly authorized workspace root.
10. Do not declare work complete without reproducible evidence such as command
    output, automated tests or an inspected diff.
