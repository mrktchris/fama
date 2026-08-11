# Triage labels

The engineering skills use five canonical triage roles. This table maps each
role to the label string used by Fama's GitHub issue tracker.

| Canonical role | GitHub label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation required |
| `needs-info` | `needs-info` | Waiting for the reporter |
| `ready-for-agent` | `ready-for-agent` | Fully specified and safe for an unattended agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation or judgment |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill names a role, apply the corresponding GitHub label. The four
non-default labels should be created in GitHub before the first triage run;
`wontfix` already exists.
