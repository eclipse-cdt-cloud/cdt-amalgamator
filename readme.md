# Eclipse CDT Debug Adapter Amalgamator

This is a debug adapter that allows common control over multiple debug adapters simulataneously,
amalgamating their outputs to provide to VSCode a single Debug Adapter interface.

## Using the Amalgamator

The amalgamator is not published and can be run within a VS Code debug session.

-   Checkout this repository
-   Checkout https://github.com/eclipse-cdt/cdt-gdb-vscode
-   Add both repositories to a new VSCode workspace
-   Build both repositories (`yarn && yarn build`)
-   Build the sample application (`make -C sampleWorkspace`)
-   Launch the `Extension` launch configuration from `.vscode/launch.json`
-   Place a breakpoint on `empty1.c` and `empty2.c`
    -   These two files represent the two processes in a multi-process debug session
-   Update the paths to `cdt-gdb-adapter/dist/debugAdapter.js` in the sample workspace's `launch.json`
-   In the _Extension Development Host_ launch the `Amalgamator Example`
-   Debug the two processes, e.g.
    -   step the processes indpe
    -   observe variables in different processes
    -   examine memory with the memory browser (`Ctrl+Shift-P` -> _GDB: Open Memory Browser_)
