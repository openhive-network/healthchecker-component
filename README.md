# Healhchecker Component for export

This project is HealthChecker Component using Wax to check the data of APIs, and providing all the necessary factors for display. You can import it to your React project, configure the props and use the generic component for handling APIs.

### Techstack
* React
* Tailwind
* Shad UI
* Typescript
* Vite
* Wax

### Structure
The project is using Wax's Healthchecker to regularly check for API's score. Then it wrap the data up in dedicated service, that will be passed as a prop to custom component. On the service declaration level devs may add list of checks and default providers.

### Instalation
For proper work of HealthChecker component you need React and Tailwind installed. If you use dev component version remember about adding `.npmrc` file to your project with:

```
@hiveio:registry=https://gitlab.syncad.com/api/v4/groups/136/-/packages/npm/
```

The component ships Tailwind CSS 4 class names, not a stylesheet. After installing the newest version of component into your project, point Tailwind at it from the CSS file that imports Tailwind (the path is relative to that file):

```
@import "tailwindcss";
@source "../node_modules/@hiveio/healthchecker-component/dist";
```

That way Tailwind can use style from component in your application. Tailwind 4's default border color is `currentcolor`; the component's bordered elements take your application's base border color (e.g. shadcn's `* { @apply border-border; }`).

You can install HealthChecker component with `pnpm` (recommended).

