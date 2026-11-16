# Daylight working notes

- Keep the warm paper, muted brick, and sage visual language. Add gentle motion with a reduced-motion alternative.
- Personal data stays browser-local. Never add a remote personal-data or AI API without a new user request.
- When work is complete, run the relevant checks, commit the finished changes with a descriptive message, and push them to the project's GitHub repository. Verify the remote commit before reporting the push as complete. The user explicitly requested this workflow.
- GitHub source repository: `https://github.com/afiqamrii/daylight.git` (`main`). Preserve its history and the user's chosen visibility.
- Publish completed website changes through Sites while preserving the existing private audience and project ID in `.openai/hosting.json`.
- Never commit credentials, browser exports, model caches, local preview files, or personal task/chat data.
- There is no build step. Serve `dist/` over HTTP for browser checks. Run `node --test tests/*.test.mjs` for the regression suite.
