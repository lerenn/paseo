# Create options

Adds a **Persona** picker to the New workspace and new-agent composers with
`client.addCreateOption`. The chosen value reaches `server.before("agent.create", ...)` as
`request.pluginOptions["create-options"].persona`; this example sets it as the `PERSONA`
environment variable of the new agent.

Install on a daemon with plugins enabled:

```bash
paseo plugin install /absolute/path/to/plugin-examples/create-options
```

Paseo holds the value until creation and never interprets it. `none` is this plugin's own default,
so the hook leaves the request alone. See the
[create options reference](../../public-docs/plugins/reference.md#create-options).
