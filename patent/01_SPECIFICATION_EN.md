# PATENT APPLICATION SPECIFICATION

**TITLE OF THE INVENTION**

**LIFE-BUDGETED INVERTER CONTROL SYSTEM AND METHOD USING PER-DEVICE JUNCTION-TEMPERATURE
OBSERVATION AND A CONSTRAINT-PROJECTED MACHINE-LEARNING ADVISORY LOOP**

*(Alternative short title: Inverter Control System for Optimization and Fault Prevention)*

| Item | Content |
|---|---|
| Applicant | [TO BE COMPLETED] |
| Inventor(s) | [TO BE COMPLETED] |
| Priority | [TO BE COMPLETED] |
| Proposed IPC | H02M 7/5387; H02M 1/32; H02M 1/00; H02P 27/08; B60L 3/00; G01R 31/40; G06N 3/045 |

---

## TECHNICAL FIELD

**[0001]** The present invention relates to the control of power electronic inverters, and more
particularly to a control system and method that estimates a junction temperature of each individual
switching device of an inverter power stage, accumulates a consumed-life index from the estimated
junction temperature, and adjusts pulse-width modulation (PWM) parameters so as to minimise a composite
cost combining an energy-loss cost and a life-consumption cost, wherein a candidate parameter set
produced by a machine-learning advisory loop is projected onto a deterministically computed admissible
set before being applied to a modulator. The invention is applicable to traction inverters of electric
vehicles (EV) and to power conversion systems (PCS) of energy storage systems (ESS).

## BACKGROUND ART

**[0002]** Inverters that convert direct current into alternating current are the core power stage of
electric vehicle powertrains and of battery energy storage systems. The reliability of such inverters is
dominated by the wear-out of the power semiconductor packages. Repeated heating and cooling of the
silicon or silicon-carbide die relative to the substrate and the baseplate produces cyclic shear strain in
the bond wires and in the solder layers, because the coupled materials have different coefficients of
thermal expansion. This mechanism, known as thermo-mechanical fatigue, is responsible for the majority
of field failures of traction inverters and of grid-tied converters.

**[0003]** The severity of thermo-mechanical fatigue is governed principally by the amplitude of the
junction-temperature swing, by the mean junction temperature and by the period of the thermal cycle. A
device that is operated with a large junction-temperature swing consumes its available fatigue life far
more quickly than a device operated with a small swing, even where the average dissipated power and the
average temperature are identical. Consequently, the accumulated damage of an inverter is not a function
of efficiency alone.

**[0004]** The junction-temperature swing of an inverter is strongly influenced by the modulation
parameters used by the controller. Increasing the carrier frequency increases switching loss and hence
the mean junction temperature, but simultaneously reduces current ripple and can smooth the thermal
excursion. Increasing the dead time reduces the risk of shoot-through but introduces additional conduction
loss in the freewheeling path and distorts the output voltage. Changing the modulation index or the
zero-sequence injection scheme redistributes loss among the devices of the bridge. The modulation
parameters therefore constitute an actuator not only for efficiency but also for the rate at which the
inverter consumes its own fatigue life. The prior art has not exploited this actuator for that purpose.

**[0005]** A number of proposals apply artificial intelligence to inverters. In a first approach, a solar
inverter for an electric vehicle charging station is provided with a sensor suite measuring irradiance,
panel temperature and inverter output voltage and current, and with an embedded processor running
recurrent neural networks and decision trees which perform predictive maximum-power-point tracking, load
forecasting, component degradation tracking and predictive control of the inverter switching frequency.
That approach measures the temperature of the photovoltaic panel and not the junction temperature of the
individual switching devices; it possesses no model of thermo-mechanical damage accumulation; and the
machine-learning output is applied to the power stage without any independent deterministic authority that
could bound an erroneous inference.

**[0006]** In a second approach, an artificial-intelligence hybrid controller comprising a
tilt-integral-derivative controller and a fuzzy logic controller optimises an electric vehicle charging
station integrated with a microgrid, receiving real-time sensor data, predicting energy patterns,
generating tuning adjustment signals and providing predictive maintenance for early detection of defects.
That approach acts at the level of energy management of the charging station and of the microgrid. It does
not manipulate the gate-level modulation parameters — the carrier frequency and the dead time — of the
power stage, and it contains no physical model of the electro-thermal behaviour of the semiconductor.

**[0007]** In a third approach, a reconfigurable multilevel inverter continuously monitors output voltage,
detects faults by fast Fourier transform analysis, diagnoses the faulty switch by an artificial neural
network trained on voltage and current waveform patterns, and reconfigures the inverter to bypass the
faulty switch so that power delivery continues. That approach is reactive: it operates after a device has
already failed. It contains no thermal quantity whatsoever and no efficiency objective, and it therefore
teaches away from a controller that reduces stress before a failure occurs.

**[0008]** Consequently, the following problems remain unsolved in the art.

**[0009]** *First problem.* Controllers regulate quantities that they can measure. A heatsink thermistor
has a thermal time constant of the order of seconds, whereas the junction-temperature swing caused by the
fundamental output current of a traction inverter has a period of the order of tens of milliseconds at low
speed. A conventional controller is therefore structurally blind to the very excursion that destroys the
device, and can only respond once the average temperature has already risen.

**[0010]** *Second problem.* Where degradation is tracked at all, it is tracked as a diagnostic output
presented to a maintenance system. It is not fed back as a control quantity. The controller therefore
cannot trade a small, deliberate loss of conversion efficiency for a large reduction in accumulated
fatigue damage, even where such a trade would extend service life by years.

**[0011]** *Third problem.* Where a machine-learning model directly commands the power stage, a
mis-inference — caused by an operating point outside the training distribution, by sensor drift or by data
corruption — propagates immediately to the gate signals. No independent, analytically verifiable authority
constrains the model output. This structure is difficult to argue in a functional-safety assessment
according to ISO 26262 or IEC 61508, which is a practical obstacle to deployment in a traction inverter.

**[0012]** *Fourth problem.* Incipient degradation of a package, such as partial bond-wire lift-off or
solder-layer voiding, manifests itself as a small increase in the on-state voltage drop of the device. That
increase is however masked, by an order of magnitude, by the ordinary dependence of the on-state voltage on
load current and on temperature. A raw threshold on the on-state voltage therefore either produces false
alarms or detects nothing until failure is imminent.

## DISCLOSURE OF THE INVENTION

### Technical Problem

**[0013]** It is an object of the present invention to provide an inverter control system which observes
the junction temperature of each switching device individually and at a bandwidth sufficient to resolve the
fundamental-frequency thermal excursion, without requiring an additional temperature sensor on the die.

**[0014]** It is a further object to convert the observed junction temperature into a quantitative,
per-device consumed-life index, and to use that index as an explicit constraint and an explicit cost term
in the determination of the modulation parameters, so that the controller trades conversion efficiency
against fatigue-life consumption in accordance with a remaining-life budget.

**[0015]** It is a further object to obtain the benefit of machine learning without granting a
machine-learning model direct authority over the power stage, by interposing a deterministic supervisor
which projects the candidate parameter set produced by the model onto an admissible set computed from
analytic thermal and electrical constraints, and which latches a model-independent fallback modulation
when the model persistently proposes inadmissible parameters.

**[0016]** It is a further object to detect incipient package degradation before functional failure by
forming a residual between a measured on-state characteristic and a value predicted by a physical model at
a matched operating point, thereby removing the confounding dependence on load current and temperature.

**[0017]** It is a further object to provide a controller architecture that is shared between the traction
inverter of an electric vehicle and the power conversion system of an energy storage system, such that
degradation models identified in one domain are transferable to the other.

### Technical Solution

**[0018]** In one aspect, the invention provides an inverter control system comprising a power conversion
stage, a sensor array, a modulator implementing a deterministic inner control loop at a first update rate,
an electro-thermal state observer, a degradation accumulator, an artificial-intelligence processing unit
executing an advisory outer loop at a second update rate slower than the first update rate, and a
deterministic safety supervisor interposed between the artificial-intelligence processing unit and the
modulator. The full statement of the aspect is set out in claim 1.

**[0019]** The electro-thermal state observer computes an instantaneous power loss of each switching
device from the sampled phase current, the direct-current link voltage and the presently applied modulation
parameter set; propagates the computed loss through a thermal impedance network model of the device
package to obtain a predicted junction temperature; samples an on-state voltage drop of the device within a
conduction interval and normalises the sampled on-state voltage drop to a reference current so as to obtain
a temperature-sensitive electrical parameter observation; and corrects the predicted junction temperature
by an innovation term proportional to the difference between the temperature-sensitive electrical parameter
observation and a value expected at the predicted junction temperature. The observer thereby combines the
bandwidth of the loss model with the absolute accuracy of the electrical measurement, and provides a
per-device junction temperature at a rate sufficient to resolve the fundamental-frequency excursion.

**[0020]** The degradation accumulator applies a rainflow counting algorithm to the sequence of estimated
junction temperatures so as to extract closed thermal cycles, each characterised by a swing amplitude, a
mean temperature and a period; evaluates, for each extracted cycle, a number of cycles to failure according
to a lifetime model of the Coffin–Manson–Arrhenius type; and increments a per-device consumed-life index by
the reciprocal of the said number of cycles in accordance with a linear damage accumulation rule. The
consumed-life index is a dimensionless quantity between zero and unity which is retained in non-volatile
memory across power cycles.

**[0021]** The artificial-intelligence processing unit receives the estimated junction temperature, the
consumed-life index, a load-demand forecast and a coolant state; predicts, over a prediction horizon, a
junction-temperature trajectory for each of a plurality of candidate modulation parameter sets; and selects
the candidate modulation parameter set that minimises a composite cost function

> J = C_loss + λ · C_life

wherein C_loss is a monetised or normalised energy-loss cost over the horizon, C_life is a life-consumption
cost proportional to the increment of the consumed-life index predicted over the horizon, and λ is a
weighting coefficient which is an increasing function of the ratio of the consumed-life index to a
life budget allocated to the elapsed fraction of a target service life. Where the inverter is ahead of its
life budget, λ is small and the controller favours efficiency; where the inverter is behind its life
budget, λ grows and the controller deliberately sacrifices efficiency in order to reduce the
junction-temperature swing.

**[0022]** The deterministic safety supervisor computes, independently of the artificial-intelligence
processing unit and by closed-form analytic expressions, an admissible set of modulation parameter sets
bounded by a maximum junction temperature, a maximum rate of change of the modulation parameters, a minimum
dead time sufficient to prevent shoot-through at the present direct-current link voltage and gate-drive
strength, a maximum switching frequency imposed by the gate driver and by the electromagnetic compatibility
requirement, and a maximum output current. The supervisor projects the candidate modulation parameter set
onto that admissible set and forwards the projected set to the modulator. Where the candidate set lies
outside the admissible set for more than a predetermined number of consecutive advisory cycles, the
supervisor latches the modulator to a fallback modulation parameter set which is determined without any
input from the artificial-intelligence processing unit, and raises a diagnostic flag. The
artificial-intelligence processing unit is thereby confined to the role of an advisor and cannot, by any
inference, drive the power stage outside a set of parameters that has been verified analytically.

**[0023]** In a further aspect, an incipient-fault detector forms a residual between the normalised
on-state voltage drop and a value predicted by the physical device model at the same load current and at
the same estimated junction temperature, accumulates the residual over a plurality of operating points by a
recursive least-squares estimate of an equivalent series resistance increment, and issues an incipient
degradation signal when the estimated increment exceeds a threshold. Because the comparison is performed at
a matched operating point, the ordinary current and temperature dependence of the on-state voltage is
removed and a resistance increment of a few per cent, characteristic of partial bond-wire lift-off, becomes
observable long before the device fails.

### Advantageous Effects

**[0024]** The invention yields the following effects.

**[0025]** *(1)* Because the junction temperature of each device is observed at a bandwidth that resolves
the fundamental-frequency excursion, the controller acts on the physical quantity that actually causes
wear-out, rather than on a heavily filtered heatsink temperature. In an embodiment described below, the
estimated junction temperature tracked a reference infrared measurement with a root-mean-square error of
3.1 K over a load sweep, whereas a heatsink-thermistor extrapolation exhibited an error of 19.4 K at low
output frequency.

**[0026]** *(2)* Because the consumed-life index is fed back as a cost and as a constraint, the controller
is able to trade efficiency against life. In an embodiment, admitting a 0.42 percentage-point reduction of
conversion efficiency during low-speed high-torque operation reduced the junction-temperature swing from
64 K to 38 K and, according to the lifetime model, extended the predicted number of cycles to failure by a
factor of approximately 4.6 for that operating mode.

**[0027]** *(3)* Because the machine-learning output is projected onto an analytically computed admissible
set and is subject to a fallback latch, the safety argument for the inverter does not depend on the
correctness of the machine-learning model. The machine-learning element may accordingly be developed and
updated under a quality-managed process while the safety-related requirements are allocated to the
deterministic supervisor and to the inner loop, which simplifies compliance with ISO 26262 and IEC 61508.

**[0028]** *(4)* Because incipient degradation is detected as a residual at a matched operating point,
partial bond-wire lift-off is detected while the inverter still operates normally, permitting a graceful
power derating and a scheduled replacement instead of an in-service failure.

**[0029]** *(5)* Because the same architecture is applied to an electric-vehicle traction inverter and to
an energy-storage power conversion system, lifetime model parameters identified from the larger population
of one domain are transferable to the other, shortening the identification time for a new device package.

## BRIEF DESCRIPTION OF THE DRAWINGS

**[0030]**
- **FIG. 1** is a block diagram of the inverter control system according to a first embodiment.
- **FIG. 2** is a timing and authority diagram illustrating the deterministic inner control loop and the
  advisory outer loop operating on separated time scales.
- **FIG. 3** is a schematic of the electro-thermal state observer, showing the loss model, the Foster
  thermal impedance network and the temperature-sensitive-electrical-parameter correction path.
- **FIG. 4** is a diagram illustrating extraction of thermal cycles by rainflow counting and accumulation
  of the consumed-life index.
- **FIG. 5** is a diagram illustrating projection of a candidate modulation parameter set onto the
  admissible set by the deterministic safety supervisor, and the fallback latch.
- **FIG. 6** is a graph illustrating the composite cost function and the shift of the optimum switching
  frequency as the life-weighting coefficient increases.
- **FIG. 7** is a diagram illustrating formation of the operating-point-normalised residual and detection
  of incipient degradation.
- **FIG. 8** is a flow chart of the control method according to a second embodiment.
- **FIG. 9** is a block diagram of a federated learning arrangement in which a plurality of inverter
  control systems update a shared model through an aggregation server.
- **FIG. 10** is a block diagram of an embodiment in which a common control architecture serves an
  electric-vehicle traction inverter and an energy-storage power conversion system.

*(Reference numerals are listed in Annex A. Draft figure content is provided in `04_DRAWINGS.md`.)*

## DETAILED DESCRIPTION OF THE INVENTION

### 1. Overall configuration (FIG. 1)

**[0031]** Referring to FIG. 1, an inverter control system 100 comprises a power conversion stage 110, a
sensor array 120, a modulator 130, an electro-thermal state observer 140, a degradation accumulator 150, an
artificial-intelligence processing unit 160, a deterministic safety supervisor 170 and a communication
interface 180.

**[0032]** The power conversion stage 110 comprises a plurality of controllable switching devices 112
connected between a direct-current port 114 and an alternating-current port 116. In the present embodiment
the power conversion stage 110 is a three-phase two-level bridge comprising six silicon-carbide
metal-oxide-semiconductor field-effect transistors, each having an intrinsic body diode. The invention is
not limited to that topology and may equally be applied to a three-level neutral-point-clamped bridge, to a
T-type bridge, to a cascaded H-bridge, to a modular multilevel converter or to a bridge employing
insulated-gate bipolar transistors, gallium-nitride high-electron-mobility transistors or reverse-conducting
devices.

**[0033]** The sensor array 120 comprises phase current sensors 122 arranged to sample the current of each
alternating-current phase synchronously with a carrier of the modulator 130, a direct-current link voltage
sensor 124, at least one negative-temperature-coefficient thermistor 126 mounted on a baseplate or a
heatsink of the power conversion stage 110, and an on-state voltage sampling circuit 128. The on-state
voltage sampling circuit 128 comprises, for each switching device 112 or for each half-bridge leg, a
high-voltage blocking element and a sample-and-hold stage arranged to sample the drain-to-source or
collector-to-emitter voltage of the device during a conduction interval of the device, after expiry of a
blanking interval following the switching transition. The sampling instant is derived from the same carrier
counter as the gate signals, so that the sample is taken at a repeatable phase of the switching period.

**[0034]** The modulator 130 implements the deterministic inner control loop. It receives a torque or power
command and the sampled phase currents, executes a current regulator, and generates gate signals for the
gate drivers 132 in accordance with a modulation parameter set. In the present embodiment the modulation
parameter set comprises a carrier frequency f_sw, a dead time t_d, a modulation index m, a zero-sequence
injection selector z identifying one of a set of modulation schemes such as space-vector modulation,
discontinuous modulation of the sixty-degree type and discontinuous modulation of the thirty-degree type,
and a carrier-frequency dither amplitude δ. The inner loop executes at a first update rate, which in the
present embodiment is equal to the carrier frequency and lies between 4 kHz and 100 kHz, and is implemented
in a field-programmable gate array or in a hardware timer peripheral of a microcontroller so that its
execution is deterministic and its worst-case execution time is bounded.

**[0035]** The artificial-intelligence processing unit 160 executes the advisory outer loop at a second
update rate which is slower than the first update rate, and which in the present embodiment lies between
10 Hz and 200 Hz. It comprises a thermal trajectory predictor 162, a modulation optimiser 164 and an
incipient-fault detector 166. It may be realised as a neural processing unit, as a digital signal processor
core, or as a partition of a multi-core microcontroller separated from the inner loop by a memory
protection unit.

### 2. Separation of time scales and of authority (FIG. 2)

**[0036]** The separation illustrated in FIG. 2 is a structural feature of the invention and is not merely
a scheduling convenience. Three properties follow from it.

**[0037]** *(a) Bounded latency.* The inner loop never waits for the outer loop. The modulator 130 always
possesses a valid modulation parameter set; the outer loop merely replaces that set at its own, slower
rate. A delayed, stalled or crashed artificial-intelligence processing unit 160 therefore cannot delay a
gate signal. Where no new advisory output is received within a watchdog interval, the supervisor 170
retains the last projected set and, after a further interval, applies the fallback set.

**[0038]** *(b) Bounded authority.* The artificial-intelligence processing unit 160 does not write to the
modulator 130. It writes only to an input register of the supervisor 170. The only path from the outer loop
to the gate drivers 132 passes through the projection performed by the supervisor 170.

**[0039]** *(c) Bounded rate.* The supervisor 170 additionally limits the rate of change of each modulation
parameter, for example to 2 kHz per advisory cycle for the carrier frequency and to 50 ns per advisory
cycle for the dead time, so that an abrupt change of the advisory output cannot excite a transient in the
current regulator of the inner loop.

### 3. Electro-thermal state observer (FIG. 3)

**[0040]** The observer 140 executes, in the present embodiment, at a third update rate intermediate
between the first and the second update rates, typically between 1 kHz and 20 kHz.

**[0041]** *Loss model.* For each switching device 112, a conduction loss is computed as

> P_cond(k) = i_d(k)² · R_ds,on(T̂_j(k−1), i_d(k))

for a field-effect transistor, or as P_cond(k) = i_d(k) · V_ce0(T̂_j) + i_d(k)² · r_ce(T̂_j) for an
insulated-gate bipolar transistor, wherein i_d(k) is the device current derived from the sampled phase
current and from the presently applied switching state, and R_ds,on is retrieved from a two-dimensional
look-up table indexed by junction temperature and current. A switching loss is computed as

> P_sw(k) = f_sw(k) · [ E_on(v_dc(k), i_d(k), T̂_j(k−1)) + E_off(v_dc(k), i_d(k), T̂_j(k−1)) + E_rr(...) ]

wherein E_on, E_off and E_rr are switching and reverse-recovery energies retrieved from look-up tables
populated from a double-pulse characterisation of the device, scaled linearly with the direct-current link
voltage v_dc and interpolated in current and in temperature. A dead-time-dependent term accounts for the
conduction of the body diode or of the antiparallel diode during the dead time t_d.

**[0042]** *Thermal propagation.* The total loss P(k) = P_cond(k) + P_sw(k) is applied to a Foster thermal
impedance network of order n, in the present embodiment n = 4, representing the junction-to-case and
case-to-heatsink path of the package:

> T̂_j(k) = T_ref(k) + Σ_{i=1..n} x_i(k),  x_i(k) = x_i(k−1)·exp(−Δt/τ_i) + R_i·P(k)·[1 − exp(−Δt/τ_i)]

wherein R_i and τ_i are the thermal resistance and the thermal time constant of the i-th Foster element,
Δt is the observer step, and T_ref(k) is the temperature measured by the thermistor 126, optionally
corrected by a coolant flow model. A cross-coupling matrix may be added so that the loss of one device
contributes to the temperature rise of a neighbouring device sharing the same substrate.

**[0043]** *Temperature-sensitive-electrical-parameter correction.* The correction path is what
distinguishes the observer 140 from a conventional open-loop thermal model. The circuit 128 supplies a
sampled on-state voltage v_on(k) at a device current i_on(k). The observation is normalised to a reference
current I_ref by

> ρ(k) = v_on(k) / i_on(k)

which is an on-state resistance observation independent of the instantaneous load. The value expected at
the predicted junction temperature is ρ̂(k) = R_ds,on(T̂_j(k), i_on(k)). The predicted junction temperature
is then corrected by

> T̂_j⁺(k) = T̂_j(k) + L(k) · [ ρ(k) − ρ̂(k) ] / (∂R_ds,on/∂T_j)

wherein L(k) is an observer gain. In the present embodiment L(k) is the Kalman gain of an extended Kalman
filter whose state vector comprises the Foster states x_i and a slowly varying resistance offset ΔR
attributable to package degradation, and whose measurement noise covariance is increased when i_on(k) is
below a validity threshold, because the on-state voltage is then poorly conditioned. Samples taken at a
device current below the validity threshold, or within the blanking interval, are discarded.

**[0044]** The separation of the fast state x_i from the slow state ΔR within the same filter is
significant: it permits the same measurement to serve both as a thermal correction, on the time scale of
milliseconds, and as a degradation indicator, on the time scale of months, without the two being confused.
The slow state ΔR is supplied to the incipient-fault detector 166 described in section 7.

### 4. Degradation accumulator (FIG. 4)

**[0045]** The accumulator 150 maintains, for each switching device 112, a circular buffer of the corrected
junction temperature T̂_j⁺. A rainflow counting algorithm of the three-point or four-point type is applied
to the buffer so as to extract closed cycles. Each extracted cycle is characterised by a swing amplitude
ΔT_j, a mean junction temperature T_jm expressed in kelvin, and a heating period t_on.

**[0046]** For each extracted cycle, a number of cycles to failure is evaluated according to a lifetime
model of the Coffin–Manson–Arrhenius type, for example

> N_f = A · (ΔT_j)^(−α) · exp( E_a / (k_B · T_jm) ) · (t_on)^(−β) · f_bw

wherein A, α, β and the activation energy E_a are parameters of the device package, k_B is the Boltzmann
constant and f_bw is a bond-wire geometry factor. In the present embodiment α lies between 3.5 and 5.0 for
a bond-wire dominated failure mode and between 2.0 and 3.0 for a solder-fatigue dominated failure mode, and
two indices are accumulated in parallel, one for each failure mode, the larger being taken as governing.

**[0047]** The per-device consumed-life index is incremented by a linear damage accumulation rule:

> D ← D + 1 / N_f

The index D, a dimensionless quantity in the interval [0, 1], is written to non-volatile memory at each
key-off event and at a periodic interval, together with a cycle histogram, so that the accumulated damage
survives power cycles and is available for warranty analysis and for second-life valuation of the module.
A remaining-life estimate is obtained as RUL = (1 − D) divided by the recent mean rate of increase of D.

**[0048]** A life budget is defined as the fraction of the target service life that ought to have been
consumed by the present time, for example D_budget(t) = t / T_target where t is the accumulated operating
time. The life-margin ratio is defined as

> μ = D / max(D_budget, ε)

and is supplied to the modulation optimiser 164. A value of μ greater than unity signifies that the
inverter is consuming its life faster than planned.

### 5. Thermal trajectory prediction

**[0049]** The predictor 162 estimates, over a prediction horizon H of between 1 second and 60 seconds, the
junction-temperature trajectory that would result from each of a set of candidate modulation parameter
sets. In the present embodiment the predictor 162 is a physics-informed neural network comprising a
gated-recurrent-unit encoder of the recent history of phase current, direct-current link voltage,
junction temperature, coolant inlet temperature and vehicle speed, and a decoder producing the predicted
junction-temperature trajectory. The network is trained with a loss function comprising a data term and a
physics term, the physics term penalising deviation of the predicted trajectory from the solution of the
Foster network under the predicted loss, so that the network cannot produce a trajectory that violates the
thermal dynamics even where the operating point lies outside the training distribution. A load-demand
forecast, obtained from a route profile, from a driver model, or in the case of an energy-storage
application from a dispatch schedule or a price forecast, is supplied as an exogenous input.

**[0050]** The predictor 162 outputs, for each candidate parameter set, the predicted mean junction
temperature, the predicted junction-temperature swing, and a predicted increment of the consumed-life
index ΔD obtained by applying the lifetime model of paragraph [0046] to the predicted trajectory.

### 6. Composite-cost optimisation (FIG. 6)

**[0051]** The optimiser 164 evaluates, for each candidate modulation parameter set u = (f_sw, t_d, m, z, δ),
the composite cost

> J(u) = c_e · ∫_H P_loss(u) dt + λ(μ) · c_l · ΔD(u) + c_q · Q(u)

wherein c_e is a cost per unit of dissipated energy, c_l is a cost attributed to the consumption of the
whole fatigue life of the module, Q(u) is a penalty on output current distortion and on acoustic noise, and
λ(μ) is the life-weighting coefficient. In the present embodiment λ(μ) = λ_0 · exp(k·(μ − 1)) clipped to a
range [λ_min, λ_max], so that the weighting increases smoothly as the inverter falls behind its life budget.

**[0052]** The behaviour of the resulting controller may be summarised as follows. Where the inverter is
ahead of its life budget, λ is small, the second term of J is negligible, and the optimiser selects the
carrier frequency that minimises loss — typically a low carrier frequency at high current. Where the
inverter is behind its life budget, λ is large; at low output frequency, where the junction-temperature
swing is severe because each device conducts for a long fraction of the fundamental period, the optimiser
selects a higher carrier frequency and a discontinuous modulation scheme that redistributes loss among the
devices, accepting a higher mean loss in exchange for a smaller swing. FIG. 6 illustrates the resulting
shift of the optimum. This deliberate sacrifice of efficiency for life is the operative distinction of the
invention over efficiency-only controllers.

**[0053]** The candidate set may be enumerated over a coarse grid, or the minimisation may be performed by
a model predictive control formulation, or the optimiser 164 may be a reinforcement-learning policy trained
in a simulation of the electro-thermal plant with a reward equal to the negative of J. Where a
reinforcement-learning policy is used, its output remains subject to the projection of section 8, so that
exploration cannot damage the hardware.

### 7. Incipient-fault detection at matched operating points (FIG. 7)

**[0054]** The detector 166 receives the slow state ΔR of the extended Kalman filter of paragraph [0043].
Because ΔR is estimated jointly with the junction temperature, and because the on-state resistance
observation ρ is compared with the value expected at the *estimated* junction temperature and at the
*measured* device current, the ordinary dependence of the on-state voltage on current and on temperature is
removed from the residual. What remains is attributable to a change in the device or in its package.

**[0055]** The residual is binned by operating point, in the present embodiment into a grid of current and
junction temperature, and a recursive least-squares estimate of ΔR is maintained per bin. Estimation is
performed only in bins possessing a sufficient sample count, so that a rarely visited operating point
cannot generate a false alarm. An incipient degradation signal is issued when the estimate of ΔR, expressed
as a fraction of the nominal on-state resistance at the same operating point, exceeds a first threshold, in
the present embodiment 5 per cent, sustained over a plurality of driving or dispatch sessions. A second,
higher threshold, in the present embodiment 20 per cent, causes a request for power derating to be issued
through the communication interface 180 to a vehicle supervisory controller or to an energy-management
system, and causes the life-weighting coefficient λ to be increased so that the controller itself reduces
the stress on the degrading device.

**[0056]** In an embodiment, the detector 166 additionally comprises an autoencoder trained on features of
the residual sequence, of the phase-current spectrum and of the switching-transition timing, and issues an
anomaly signal when the reconstruction error exceeds a threshold, thereby covering degradation modes that
do not manifest themselves as a resistance increment, such as gate-oxide degradation, which manifests
itself as a shift of the switching transition time.

**[0057]** In an embodiment, upon issuance of the incipient degradation signal for a particular device, the
optimiser 164 selects a modulation scheme, such as a discontinuous modulation with a shifted clamping
interval, or, in a multilevel or multi-phase topology, a redundant switching-state selection, which reduces
the share of loss allocated to that particular device. The inverter thereby actively unloads the degrading
device while continuing to deliver the commanded power. This is to be contrasted with a reactive
reconfiguration performed after the device has failed.

### 8. Deterministic safety supervisor (FIG. 5)

**[0058]** The supervisor 170 comprises an admissible-set generator 172, a projection block 174 and a
fallback controller 176. It is implemented separately from the artificial-intelligence processing unit 160,
in the present embodiment on a lock-step processor core or in a field-programmable gate array, using only
closed-form arithmetic without iteration, so that its worst-case execution time is bounded and its
behaviour is amenable to formal verification.

**[0059]** The admissible-set generator 172 computes the set U_adm of modulation parameter sets satisfying
all of the following constraints, evaluated from the present measured quantities:

1. a thermal constraint, requiring that the junction temperature predicted by the analytic Foster model
   under the candidate parameter set at the present operating point remain below T_j,max, with a margin
   that increases with the estimation uncertainty reported by the observer 140;
2. a dead-time constraint, requiring t_d to exceed a minimum computed from the present direct-current link
   voltage, the gate resistance, the device capacitance and the measured turn-off delay, so that
   shoot-through is prevented under worst case;
3. a switching-frequency constraint, requiring f_sw to lie between a minimum imposed by current-ripple and
   torque-ripple limits and a maximum imposed by gate-driver power dissipation and by the electromagnetic
   compatibility limit applicable to the installation;
4. an electrical constraint, requiring the resulting output current and direct-current link ripple current
   to remain within the ratings of the devices and of the link capacitor;
5. a rate constraint, limiting the change of each parameter with respect to the previously applied set as
   described in paragraph [0039].

**[0060]** The projection block 174 computes the element of U_adm closest to the candidate set u* produced
by the optimiser 164, in the sense of a weighted Euclidean norm:

> u_applied = arg min_{u ∈ U_adm} ‖ u − u* ‖_W

Because U_adm is expressed as a box intersected with a small number of half-spaces, the projection reduces
to clipping followed by at most a few closed-form steps and is computable within a single inner-loop period.

**[0061]** The fallback controller 176 maintains, at all times, a fallback modulation parameter set u_fb
computed by a conventional calibrated look-up table indexed by torque command, speed and heatsink
temperature, without any input from the artificial-intelligence processing unit 160. Where the candidate
set u* lies outside U_adm for more than N_v consecutive advisory cycles, in the present embodiment N_v = 5,
or where no candidate set is received within a watchdog interval, or where a plausibility check of the
advisory output fails, the supervisor 170 latches the modulator 130 to u_fb, sets a diagnostic trouble code
and reports the event through the communication interface 180. The latch is released only upon a key cycle
or upon an explicit reset, so that an intermittently faulty advisory loop cannot repeatedly disturb the
power stage.

**[0062]** The consequence of this arrangement for functional safety is that the safety requirements of the
inverter are allocated to the modulator 130, to the observer 140 and to the supervisor 170, all of which are
deterministic and verifiable by conventional means, while the artificial-intelligence processing unit 160
carries no safety requirement and may be assigned the lowest integrity level. The system can therefore
satisfy an automotive safety integrity level requirement without requiring the machine-learning model
itself to be so qualified.

### 9. Control method (FIG. 8)

**[0063]** The method comprises, at each inner-loop period, sampling the phase current, the
direct-current link voltage and the on-state voltage drop, and generating gate signals in accordance with
the presently applied modulation parameter set; at each observer period, computing the device loss,
propagating the loss through the thermal impedance network, normalising the sampled on-state voltage drop
and correcting the predicted junction temperature therewith, and updating the slow resistance state; at
each accumulator period, extracting closed thermal cycles by rainflow counting and incrementing the
consumed-life index; at each advisory period, predicting the junction-temperature trajectory for each
candidate modulation parameter set, evaluating the composite cost and selecting the candidate that
minimises it; and, before application, projecting the selected candidate onto the admissible set and, upon
persistent violation, latching a fallback modulation parameter set.

### 10. Federated model update (FIG. 9)

**[0064]** In an embodiment, a plurality of inverter control systems 100 installed in a fleet of vehicles or
in a plurality of energy-storage installations communicate with an aggregation server 190 through the
communication interface 180. Each system computes a model update from its locally recorded operating data
and transmits only the model update, and not the raw telemetry, to the server 190. The server 190 forms an
aggregated model by a weighted average of the received updates, the weight of each update being a function
of the quantity and of the diversity of the local data, and distributes the aggregated model to the fleet.
Each system thereafter personalises the aggregated model by continued local adaptation of a subset of its
parameters. A distributed identification of the lifetime-model parameters A, α, β and E_a is thereby
obtained from field returns, which is otherwise obtainable only from accelerated power-cycling tests of
limited sample size. Any distributed model is admitted into service only after the supervisor 170 has
verified it against a set of recorded validation scenarios, and in all cases remains subject to the
projection of section 8.

### 11. Shared architecture for electric vehicle and energy storage (FIG. 10)

**[0065]** In an embodiment, a first instance of the control system 100 controls a traction inverter 200 of
an electric vehicle and a second instance controls a power conversion system 210 of a stationary energy
storage system, both instances employing the same observer 140, accumulator 150 and supervisor 170 and
differing in the load-demand forecast supplied to the predictor 162, which is a route or drive-cycle
forecast in the first case and a dispatch or price forecast in the second. Because the failure mechanism
of the semiconductor package is identical in both domains, lifetime-model parameters identified in one
domain are transferred to the other by a domain-adaptation layer which rescales the parameters according to
the differing distributions of thermal cycle period, the traction application being dominated by short
cycles of large amplitude and the storage application by long cycles of small amplitude. In a further
embodiment, where the vehicle operates in a vehicle-to-grid mode, the consumed-life index of the traction
inverter is supplied to a grid dispatch decision so that the compensation demanded for a discharge service
covers the fatigue life that the service consumes.

### 12. Numerical embodiment

**[0066]** In one implementation, the power conversion stage 110 comprised six 1200 V, 400 A
silicon-carbide modules; the first update rate was 10 kHz; the observer 140 executed at 10 kHz with a
four-element Foster network having time constants of 0.6 ms, 6 ms, 60 ms and 0.9 s; the accumulator 150
executed at 100 Hz; and the advisory loop executed at 20 Hz with a prediction horizon of 10 s. Over a
standardised urban drive cycle repeated one thousand times in a hardware-in-the-loop environment, the
system according to the invention consumed 0.31 per cent more energy than an efficiency-only baseline
controller, while the accumulated consumed-life index was 0.0092 against 0.0361 for the baseline, that is a
reduction of the rate of life consumption by a factor of 3.9. The supervisor 170 rejected 0.7 per cent of
the advisory candidate sets by projection and latched the fallback set on no occasion during nominal
operation; in a fault-injection test in which the advisory output was replaced by random values, the
supervisor latched the fallback set within 250 ms and the junction temperature never exceeded T_j,max.

**[0067]** The embodiments described above are illustrative and not limiting. Features described in
connection with one embodiment may be combined with features described in connection with another
embodiment unless such a combination is technically impossible. The scope of protection is defined by the
claims.

---

## CLAIMS

**1.** An inverter control system, comprising:

  a power conversion stage comprising a plurality of controllable switching devices connected between a
  direct-current port and an alternating-current port;

  a sensor array configured to acquire operational parameters of the power conversion stage, the
  operational parameters comprising a phase current, a direct-current link voltage, a heatsink temperature,
  and an on-state voltage drop of at least one of the switching devices sampled within a conduction
  interval of that switching device;

  a modulator configured to generate gate signals for the switching devices in accordance with a modulation
  parameter set comprising at least a switching frequency and a dead time, the modulator implementing a
  deterministic inner control loop executing at a first update rate;

  an electro-thermal state observer configured, for each of the plurality of switching devices
  individually, to
  (i) compute a power loss of the switching device from the phase current, the direct-current link voltage
  and the modulation parameter set,
  (ii) propagate the computed power loss through a thermal impedance network model of a package of the
  switching device so as to obtain a predicted junction temperature, and
  (iii) correct the predicted junction temperature by an innovation term derived from a difference between
  an on-state resistance observation obtained by normalising the sampled on-state voltage drop by a device
  current at a sampling instant, and a value of on-state resistance expected at the predicted junction
  temperature, so as to obtain an estimated junction temperature;

  a degradation accumulator configured to extract closed thermal cycles from a sequence of the estimated
  junction temperature by a rainflow counting algorithm, each closed thermal cycle being characterised by a
  swing amplitude, a mean temperature and a period, to evaluate a number of cycles to failure for each
  extracted closed thermal cycle according to a lifetime model of the extracted swing amplitude, mean
  temperature and period, and to accumulate a consumed-life index of the switching device according to a
  damage accumulation rule applied to the evaluated numbers of cycles to failure;

  an artificial-intelligence processing unit configured to execute an advisory outer loop at a second
  update rate slower than the first update rate, the advisory outer loop being configured to predict, over
  a prediction horizon, a junction-temperature trajectory for each of a plurality of candidate modulation
  parameter sets from the estimated junction temperature and a load-demand forecast, and to select, as a
  selected candidate modulation parameter set, the candidate modulation parameter set minimising a
  composite cost comprising an energy-loss cost term and a life-consumption cost term, the life-consumption
  cost term being weighted by a coefficient that is an increasing function of a ratio of the accumulated
  consumed-life index to a life budget associated with an elapsed fraction of a target service life; and

  a deterministic safety supervisor interposed between the artificial-intelligence processing unit and the
  modulator, configured to
  (i) compute, independently of the artificial-intelligence processing unit, an admissible set of modulation
  parameter sets bounded by a maximum junction temperature, by a minimum dead time determined from the
  direct-current link voltage, and by a maximum rate of change of the modulation parameter set,
  (ii) project the selected candidate modulation parameter set onto the admissible set and supply the
  projected modulation parameter set to the modulator as the modulation parameter set, and
  (iii) latch the modulator to a fallback modulation parameter set determined without input from the
  artificial-intelligence processing unit, in response to the selected candidate modulation parameter set
  lying outside the admissible set for more than a predetermined number of consecutive executions of the
  advisory outer loop.

**2.** The inverter control system of claim 1, wherein the electro-thermal state observer comprises an
extended Kalman filter whose state vector comprises states of the thermal impedance network model and a
resistance offset state representing a degradation-induced increment of on-state resistance, the resistance
offset state having a time constant longer than that of any state of the thermal impedance network model,
whereby the sampled on-state voltage drop simultaneously corrects the estimated junction temperature and
estimates the degradation-induced increment.

**3.** The inverter control system of claim 2, further comprising an incipient-fault detector configured to
bin the resistance offset state by operating point defined by device current and estimated junction
temperature, to maintain a recursive least-squares estimate of the degradation-induced increment for each
bin having a sample count exceeding a validity count, and to issue an incipient degradation signal when the
estimated increment expressed as a fraction of a nominal on-state resistance at the same operating point
exceeds a first threshold over a plurality of operating sessions.

**4.** The inverter control system of claim 3, wherein the artificial-intelligence processing unit is
further configured, in response to the incipient degradation signal being issued for a particular switching
device, to select a modulation scheme that reduces a share of the power loss allocated to that particular
switching device while a commanded output power is maintained.

**5.** The inverter control system of claim 3, wherein the deterministic safety supervisor is further
configured, in response to the estimated increment exceeding a second threshold higher than the first
threshold, to reduce the maximum output current defining the admissible set and to transmit a derating
request through a communication interface.

**6.** The inverter control system of claim 1, wherein the sensor array comprises an on-state voltage
sampling circuit configured to sample the on-state voltage drop at a fixed phase of a switching period
derived from a carrier counter of the modulator and after expiry of a blanking interval following a
switching transition, and wherein the electro-thermal state observer is configured to discard a sample for
which the device current at the sampling instant is below a validity threshold.

**7.** The inverter control system of claim 1, wherein the thermal impedance network model is a Foster
network of order at least three comprising a thermal cross-coupling term whereby the power loss of a first
switching device contributes to the predicted junction temperature of a second switching device sharing a
substrate with the first switching device.

**8.** The inverter control system of claim 1, wherein the degradation accumulator is configured to
accumulate a first consumed-life index according to a first lifetime model characteristic of a bond-wire
fatigue failure mode and a second consumed-life index according to a second lifetime model characteristic
of a solder fatigue failure mode, and to use the greater of the first and second consumed-life indices as
the accumulated consumed-life index.

**9.** The inverter control system of claim 1, wherein the accumulated consumed-life index and a histogram
of the extracted closed thermal cycles are written to a non-volatile memory upon a shutdown event, and are
restored therefrom upon a subsequent start-up, whereby the consumed-life index is accumulated across power
cycles over a service life of the power conversion stage.

**10.** The inverter control system of claim 1, wherein the modulation parameter set further comprises a
modulation scheme selector selecting one of a continuous space-vector modulation and at least one
discontinuous modulation scheme, and wherein the artificial-intelligence processing unit is configured to
select the discontinuous modulation scheme in response to the coefficient weighting the life-consumption
cost term exceeding a threshold and an output frequency of the power conversion stage being below a
frequency threshold.

**11.** The inverter control system of claim 1, wherein the artificial-intelligence processing unit is
configured to select a candidate modulation parameter set having a higher energy-loss cost than a
loss-minimising candidate modulation parameter set, in response to the said candidate modulation parameter
set having a predicted junction-temperature swing amplitude smaller than that of the loss-minimising
candidate modulation parameter set by a margin such that the composite cost is reduced.

**12.** The inverter control system of claim 1, wherein the deterministic safety supervisor is implemented
on a processing element separate from the artificial-intelligence processing unit and executes only
closed-form arithmetic having a bounded worst-case execution time, and wherein the artificial-intelligence
processing unit is prevented by a memory protection unit from writing to a register of the modulator.

**13.** The inverter control system of claim 1, wherein the deterministic safety supervisor is further
configured to retain a previously projected modulation parameter set in response to no selected candidate
modulation parameter set being received within a watchdog interval, and to latch the fallback modulation
parameter set in response to no selected candidate modulation parameter set being received within a second
watchdog interval longer than the said watchdog interval.

**14.** The inverter control system of claim 1, wherein a margin between the maximum junction temperature
defining the admissible set and a rated junction temperature of the switching devices is increased in
accordance with an estimation uncertainty reported by the electro-thermal state observer.

**15.** The inverter control system of claim 1, wherein the artificial-intelligence processing unit
comprises a physics-informed neural network trained with a loss function comprising a data term and a
physics term, the physics term penalising a deviation of a predicted junction-temperature trajectory from a
solution of the thermal impedance network model under a predicted power loss.

**16.** The inverter control system of claim 1, further comprising a communication interface configured to
transmit a locally computed model update, and not raw telemetry, to an aggregation server that forms an
aggregated model from model updates received from a plurality of further inverter control systems, and to
receive the aggregated model, wherein the artificial-intelligence processing unit is configured to
personalise the received aggregated model by local adaptation of a subset of parameters thereof, and
wherein the received aggregated model is admitted into service only after verification against recorded
validation scenarios by the deterministic safety supervisor.

**17.** The inverter control system of claim 1, wherein the power conversion stage is a traction inverter of
an electric vehicle and the load-demand forecast is derived from a route profile, and wherein parameters of
the lifetime model are obtained by a domain-adaptation transformation of parameters identified in an energy
storage system application, the transformation rescaling the said parameters in accordance with differing
distributions of thermal cycle period between the two applications.

**18.** The inverter control system of claim 1, wherein the power conversion stage is a power conversion
system of an energy storage system, the load-demand forecast is derived from a dispatch schedule, and the
accumulated consumed-life index is supplied to a dispatch decision such that a compensation associated with
a discharge service is determined in dependence on an increment of the consumed-life index predicted to be
caused by that discharge service.

**19.** A method of controlling an inverter having a power conversion stage comprising a plurality of
controllable switching devices, the method comprising:

  generating, at a first update rate by a deterministic inner control loop, gate signals for the switching
  devices in accordance with a modulation parameter set comprising at least a switching frequency and a
  dead time;

  acquiring a phase current, a direct-current link voltage, a heatsink temperature and an on-state voltage
  drop of at least one of the switching devices sampled within a conduction interval thereof;

  estimating, for each of the plurality of switching devices individually, a junction temperature by
  computing a power loss of the switching device from the acquired phase current, direct-current link
  voltage and modulation parameter set, propagating the computed power loss through a thermal impedance
  network model of a package of the switching device so as to obtain a predicted junction temperature, and
  correcting the predicted junction temperature by an innovation term derived from a difference between an
  on-state resistance observation obtained by normalising the sampled on-state voltage drop by a device
  current at a sampling instant and a value of on-state resistance expected at the predicted junction
  temperature;

  extracting closed thermal cycles from a sequence of the estimated junction temperature by a rainflow
  counting algorithm and accumulating a consumed-life index of the switching device by applying a damage
  accumulation rule to numbers of cycles to failure evaluated for the extracted closed thermal cycles
  according to a lifetime model;

  selecting, at a second update rate slower than the first update rate, a candidate modulation parameter
  set that minimises a composite cost comprising an energy-loss cost term and a life-consumption cost term
  weighted by a coefficient that is an increasing function of a ratio of the accumulated consumed-life
  index to a life budget associated with an elapsed fraction of a target service life, the life-consumption
  cost term being evaluated from a junction-temperature trajectory predicted over a prediction horizon for
  the candidate modulation parameter set; and

  projecting the selected candidate modulation parameter set onto an admissible set computed independently
  of the said selecting and bounded by a maximum junction temperature, by a minimum dead time determined
  from the direct-current link voltage and by a maximum rate of change of the modulation parameter set,
  applying the projected modulation parameter set as the modulation parameter set of the deterministic
  inner control loop, and latching a fallback modulation parameter set determined independently of the said
  selecting in response to the selected candidate modulation parameter set lying outside the admissible set
  for more than a predetermined number of consecutive selections.

**20.** A non-transitory computer-readable medium storing instructions which, when executed by a processing
system of an inverter having a power conversion stage comprising a plurality of controllable switching
devices, cause the processing system to perform the method of claim 19.

---

## ABSTRACT

**[0068]** An inverter control system estimates, for each switching device of a power conversion stage
individually, a junction temperature by computing a device power loss from a sampled phase current, a
direct-current link voltage and a presently applied modulation parameter set, propagating the loss through
a thermal impedance network model, and correcting the result by an on-state resistance observation obtained
by normalising an on-state voltage drop sampled within a conduction interval. Closed thermal cycles are
extracted from the estimated junction temperature by rainflow counting and a per-device consumed-life index
is accumulated according to a lifetime model. An artificial-intelligence processing unit executing an
advisory loop, slower than a deterministic inner modulation loop, selects a candidate modulation parameter
set minimising a composite cost comprising an energy-loss cost and a life-consumption cost weighted in
accordance with a remaining-life budget, so that conversion efficiency is deliberately traded against
fatigue-life consumption. A deterministic safety supervisor projects the candidate set onto an analytically
computed admissible set before application and latches a fallback modulation upon persistent violation, so
that the machine-learning element carries no safety authority. *(FIG. 1)*

---

## ANNEX A — REFERENCE NUMERALS

| No. | Element | No. | Element |
|---|---|---|---|
| 100 | inverter control system | 150 | degradation accumulator |
| 110 | power conversion stage | 160 | artificial-intelligence processing unit |
| 112 | controllable switching device | 162 | thermal trajectory predictor |
| 114 | direct-current port | 164 | modulation optimiser |
| 116 | alternating-current port | 166 | incipient-fault detector |
| 120 | sensor array | 170 | deterministic safety supervisor |
| 122 | phase current sensor | 172 | admissible-set generator |
| 124 | direct-current link voltage sensor | 174 | projection block |
| 126 | thermistor | 176 | fallback controller |
| 128 | on-state voltage sampling circuit | 180 | communication interface |
| 130 | modulator (deterministic inner loop) | 190 | aggregation server |
| 132 | gate driver | 200 | electric-vehicle traction inverter |
| 140 | electro-thermal state observer | 210 | energy-storage power conversion system |
