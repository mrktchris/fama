# Issue tracker: GitHub

Issues and PRDs for this repository live as GitHub issues in `mrktchris/fama`.
Use the `gh` CLI for issue operations from the repository clone.

## Conventions

- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --comments` and include labels.
- List: `gh issue list --state open --json number,title,body,labels,comments` with appropriate filters.
- Comment: `gh issue comment <number> --body-file <file>`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically from
inside the clone.

## Skill routing

- “Publish to the issue tracker” means create a GitHub issue.
- “Fetch the relevant ticket” means run `gh issue view <number> --comments`.
