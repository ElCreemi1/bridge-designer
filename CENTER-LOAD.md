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

It analyzes one planar truss. Lateral bracing, twisting, out-of-plane buckling, glue joints and large deflections are not modeled.

## Limits

Both static modes are linear-elastic, small-deflection explorations, not safety ratings. Results past capacity are warnings; post-failure shapes are not predicted. Unstable structures show an error and the undeformed bridge in neutral color.

## Automated checks

The APK workflow runs `src/app/features/center-load/*.spec.ts` and the fly-thru specs before packaging. Pasta tests cover 1.00 m scaling, statics of a reference truss, virtual-work deflection, self-weight, buckling versus crushing, the first-failure load, invalid input and instability.
