# Static load modes in the 3D simulation

The simulation pane's selector offers three modes, all drawn in the same 3D scene:

| Mode | Analysis | Units |
|---|---|---|
| Moving truck (3D) | Existing highway truck test, traversal and collapse animation | Existing |
| Center load (3D static) | Existing steel model with retained factored dead loads plus one midspan force | kN per modeled truss |
| Pasta 1.00 m (3D static) | Independent solver: drawing scaled to a 1.00 m deck span, one circular strand per member, self-weight plus one midspan force | N |

Static modes replace the simulation's interpolator with a fixed response (`SimulationStateService.setStaticResponse`). The truck is hidden, traversal and collapse are suspended, and the existing camera and overlay controls keep working. Member colors use the existing scheme: gray to blue for tension, gray to red for compression, saturated at capacity. Deflection exaggeration is adjustable (default 20x center, 10x pasta). Pasta mode also hides the deck slabs and beams. Choosing Moving truck again replays the truck test from its start.

## Center load

The center is halfway between the first and last deck-joint x coordinates. Load is applied at that joint when one exists; otherwise the adjacent deck joints receive the simply supported panel reactions P*(xR-x)/(xR-xL) and P*(x-xL)/(xR-xL).

A private AnalysisService instance with unit axle parameters gives single-joint 1 kN incremental load cases, normalizing the solver factor 1.75*1.33, and an equilibrium check guards against later normalization changes. The response is dead load plus P times weighted unit increments. Member forces are recomputed from Float64 displacements to avoid Float32 cancellation. Standard truck results and member report fields are not modified.

## Pasta

`pasta-analysis.ts` is a separate direct-stiffness 2D truss solver in SI units. Supports mirror the app solver's restraint rules (including piers, arches and anchorages). Inputs: diameter, elastic modulus, tensile strength, compressive strength and density. Defaults are placeholders, not measured data. Each member's self-weight is split equally to its end joints. Tension capacity is A*ft; compression capacity is the smaller of A*fc and pinned-end Euler buckling pi^2*E*I/L^2. The panel also reports pasta mass, strand length and the linear force at which the first member reaches capacity.

### Pasta site (1.00 m)

The setup wizard's step 2 offers "Pasta bridge (1.00 m span)". It is a separate design type (scenario code 5101220000, tag 02P): load-case digit 5 on the 10-panel geometry of site 02, so the 40 m world deck span represents exactly 1.00 m (one world meter = 2.5 cm). Grid snapping, templates and drawing tools are reused unchanged. What changes on this site:

- Drawing: two tables with a pin support on the left and a roller on the right, a dashed deck line, and only the design space (30 cm above to 50 cm below the deck) plus a 7.5 cm margin. No river valley, road labels, or steel slenderness marks.
- Rulers in centimeters; member table lengths in cm. Slenderness and steel force/strength columns show dashes. The toolbar shows total strand length instead of steel cost. The status icon reports stability only.
- The 3D view opens in the Pasta simulation and hides terrain, abutments and the wind turbine.
- Strand length limit: members longer than one strand (default 25 cm, editable under Strand properties, remembered on the device) are drawn with a red dashed mark and a red length cell. The pasta panel lists them on any site at 1.00 m scale, and the optimizer refuses to run until they are shortened.

### Strand bundles and optimizer

Each member can hold a whole number of strands (default 1). Strands are loose: joined only at the joints and not bonded along their length, so each strand buckles independently. A bundle of n strands has n times the area, axial stiffness, weight, tensile capacity and compressive capacity of one strand (n*A*ft and n*min(A*fc, pi^2*E*I/L^2)). Gluing strands along their length would raise buckling capacity toward n^2 times one strand's bending stiffness; that is deliberately not modeled.

Optimize strands keeps the drawn geometry and maximizes the linear first-failure center load within a mass budget and a per-member strand limit. It repeatedly adds a strand to the member that fails first, then removes any strand whose removal does not lower the failure load, repeating until neither step changes anything. Because member forces are recomputed after each change, statically indeterminate trusses are handled. The result is a good local optimum for whole strand counts, not a proven global optimum, and the panel reports efficiency in N/g. Strand counts reset when the member count changes.

It analyzes one planar truss. Lateral bracing, twisting, out-of-plane buckling, glue joints and large deflections are not modeled.

## Limits

Both static modes are linear-elastic, small-deflection explorations, not safety ratings. Results past capacity are warnings; post-failure shapes are not predicted. Unstable structures show an error and the undeformed bridge in neutral color.

## Automated checks

The APK workflow runs `src/app/features/center-load/*.spec.ts` and the fly-thru specs before packaging. Pasta tests cover the pasta site (validity, scale, saved code, steel sites unchanged, drawing window), the strand length limit, loose-bundle scaling, the strand optimizer (budget, member limit, no removable strands, beating uniform bundles, rescuing a self-weight failure), 1.00 m scaling, statics of a reference truss, virtual-work deflection, self-weight, buckling versus crushing, the first-failure load, invalid input and instability.
