# Experimental centered-load mode

Select Center load (2D static) in the simulation pane. The slider covers 0-1000 kN in 5 kN steps; numeric entry supports intermediate values. Default is 250 kN. Force is per modeled truss, not combined force across a pair of side trusses. No new mode data is written to the bridge file.

## Model

The center is halfway between the first and last deck-joint x coordinates. Load is applied at that joint when one exists. Otherwise the adjacent deck joints receive the simply supported panel reactions: P*(xR-x)/(xR-xL) and P*(x-xL)/(xR-xL). This is an idealized transfer, not a deck-bending analysis.

The feature uses a private instance of the existing AnalysisService. Private axle parameters generate single-joint 1 kN incremental load cases, normalizing the current solver factor 1.75*1.33. Actual joint equilibrium is checked to catch a later incompatible normalization change. The center response uses linear superposition: dead-load response plus P times weighted unit-load increments. Original solver dead-load factors, restraints, stiffness and member-strength calculations are retained. No extra truck or dynamic-impact factor is added to P.

At 0 kN only the app's existing factored dead loads remain. A component-scoped analyzer runs quietly without populating member report fields or notifying the global truck-analysis workflow. Standard truck tests and their results remain separate. Switching back to truck mode restarts its simulation.

## Display and limits

The view is a 2D side-view static response, not a modified 3D truck or collapse animation. Deflection is displayed at 20x actual calculated displacement. Gray dashed members show original geometry; blue is tension, orange compression, and red is a force/strength ratio exceeding one. Excessive displacements can leave the plot. Slenderness failures are reported separately.

Unstable structures show an error rather than fabricated results. This is an exploratory linear-elastic truss model, not a safety certification or a predictor of post-failure geometry. Deck bending, three-dimensional load sharing, nonlinear and large-deformation effects are not modeled.

## Automated checks

The APK workflow must pass center-load.spec.ts before packaging. Tests cover direct midpoint loading, nonuniform panel load/moment conservation, invalid input, zero load, a symmetric five-member truss's incremental member forces, its virtual-work center deflection, linear scaling of added force, preservation of member report fields, and unstable-bridge handling. These tests do not replace device testing or engineering validation of the entire application.
