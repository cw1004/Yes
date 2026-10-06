#!/usr/bin/env python3
"""SI-100 adsorber tube: 2D (r, theta) transient heat + adsorption, one full day.

WHY 2D AND NOT 3D
-----------------
Dimensional scoping of the Maxsorb/methanol bed inside a SS316L Ph60.3 x 1.5
tube over the daily cycle gives:

    radial   (22.65 mm annulus)  Fo(desorb) = 12 .. 49   -> near equilibrium,
                                                            but tau = 7..27 min,
                                                            so it is resolved here
    axial    (1000 mm tube)      Fo = 0.006 .. 0.025     -> no axial coupling at
                                                            all; every z slice is
                                                            independent AND
                                                            identically driven,
                                                            so one slice is the
                                                            whole tube
    circumf. (steel wall fin)    m * arc = 0.65 .. 1.29   -> the wall only PARTLY
                                                            shorts the top-bottom
                                                            gradient: must resolve

So the honest model is one (r, theta) slice, not a 3D mesh. Full 3D would only
add the end effects at the manifolds.

Vapour transport is treated as instantaneous and the bed pressure as uniform:
radial Darcy drop through the packed bed is 37 Pa at the 2.92 kPa adsorption
pressure (1.3 % of P, 0.28 K of saturation shift) and 14 Pa at 21.9 kPa.
Knudsen number 0.035 - still viscous. Mass transfer is not a limit here.

PHYSICS
-------
Local equilibrium Dubinin-Astakhov uptake x(T, P) everywhere in the bed. The
latent term is folded into an effective heat capacity, which is what makes the
scheme both exact and unconditionally well-signed:

    rho_b [ c_s + x c_liq - h_ads dx/dT ] dT/dt
        = div(k grad T) + rho_b h_ads (dx/dP) dP/dt

dx/dT < 0, so the bracket GROWS - a desorbing bed is sluggish because it is
soaking latent heat. Both derivatives are analytic (see dxdT, dxdP).

The system pressure is not prescribed. In the isosteric legs it is solved each
sub-interval from conservation of adsorbed mass, integral(x dV) = const; in the
desorption and adsorption legs it is pinned at the condenser or evaporator
saturation pressure and the mass difference is condensed or evaporated. That
reproduces the real Clapeyron trajectory of a valveless solar machine instead
of assuming it.
"""
import math, os, sys, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from adsorption_chiller import psat_meoh, hfg_meoh
import icemaker_spec as IM

S = IM.SPEC
R_GAS = 8.314
# Antoine for methanol as used repo-wide: log10(P[bar]) = A - B/(T_K + C)
ANT_A, ANT_B, ANT_C = 5.20409, 1581.341, -33.50
# Dubinin-Astakhov constants, as in adsorption_chiller.x_maxsorb
W0, E_DA, N_DA, RHO_AD = 1.75e-3, 10.5e3, 1.8, 750.0
X_MAX = W0 * RHO_AD                       # saturated uptake, kg/kg


# --------------------------------------------------------------- properties
def psat(Tc):
    """Saturation pressure, Pa. Array-safe."""
    return 10.0 ** (ANT_A - ANT_B / (Tc + 273.15 + ANT_C)) * 1e5


def dlnps_dT(Tc):
    return math.log(10.0) * ANT_B / (Tc + 273.15 + ANT_C) ** 2


def uptake(Tc, P):
    """DA uptake kg/kg, and the two analytic derivatives, all array-safe."""
    Tk = Tc + 273.15
    Ps = psat(Tc)
    sat = P >= Ps
    ratio = np.where(sat, 1.0 + 1e-12, Ps / np.maximum(P, 1e-6))
    A = R_GAS * Tk * np.log(ratio)
    A = np.maximum(A, 1e-9)
    u = (A / E_DA) ** N_DA
    x = X_MAX * np.exp(-u)
    # d x / d A  = -x * n * (A/E)^(n-1) / E
    dxdA = -x * N_DA * (A / E_DA) ** (N_DA - 1.0) / E_DA
    dAdT = R_GAS * np.log(ratio) + R_GAS * Tk * dlnps_dT(Tc)
    dAdP = -R_GAS * Tk / np.maximum(P, 1e-6)
    dxdT = dxdA * dAdT
    dxdP = dxdA * dAdP
    x = np.where(sat, X_MAX, x)
    dxdT = np.where(sat, 0.0, dxdT)
    dxdP = np.where(sat, 0.0, dxdP)
    return x, dxdT, dxdP


# ----------------------------------------------------------------- forcing
def solar(t_h, H_day, sunrise=8.0, sunset=18.0):
    """Tilted-plane irradiance, W/m2, as a half-sine integrating to H_day."""
    if not (sunrise <= t_h <= sunset):
        return 0.0
    span = (sunset - sunrise) * 3600.0
    peak = math.pi / 2.0 * H_day / span
    return peak * math.sin(math.pi * (t_h - sunrise) / (sunset - sunrise))


def ambient(t_h, lo=22.0, hi=34.0, t_peak=15.0):
    return (lo + hi) / 2 - (hi - lo) / 2 * math.cos(2 * math.pi * (t_h - t_peak + 12.0) / 24.0)


# ------------------------------------------------------------------- model
class Adsorber2D:
    def __init__(self, nr=20, nt=40, k_bed=None, theta_bond_deg=30.0,
                 h_contact=3000.0, night_vent=False, U_night=None,
                 eps_plate=0.10, H_day=None, nr_steel=1, axisym=False,
                 charge_scale=1.0, back_full=False):
        self.nr, self.nt, self.nr_steel = nr, nt, nr_steel
        self.k_bed = S['k_bed'] if k_bed is None else k_bed
        self.theta_bond = math.radians(theta_bond_deg)
        self.h_contact = h_contact
        self.night_vent = night_vent
        # with the glazing in place and a selective coating the collector's own
        # loss coefficient is the ONLY night-time heat rejection path
        self.U_night = U_night
        self.eps_plate = eps_plate
        self.H_day = S['H_sun'] if H_day is None else H_day

        # ---- radial grid: bed cells, then the steel wall ------------------
        r_i = S['core_od'] / 2000.0
        r_wi = (S['tube_od'] - 2 * S['tube_wall']) / 2000.0
        r_wo = S['tube_od'] / 2000.0
        rf_bed = np.linspace(r_i, r_wi, nr + 1)
        rf_st = np.linspace(r_wi, r_wo, nr_steel + 1)[1:]
        self.rf = np.concatenate([rf_bed, rf_st])          # nr+nr_steel+1 faces
        self.r = 0.5 * (self.rf[1:] + self.rf[:-1])
        self.dr = np.diff(self.rf)
        self.n = nr + nr_steel
        self.is_bed = np.zeros(self.n, bool); self.is_bed[:nr] = True

        # ---- angular grid: theta = 0 at the TOP (sun side), periodic ------
        self.dth = 2 * math.pi / nt
        self.th = (np.arange(nt) + 0.5) * self.dth
        self.L = S['tube_len'] / 1000.0

        # per-cell material
        self.k = np.where(self.is_bed, self.k_bed, 15.0)[:, None] * np.ones((1, nt))
        self.rhoc_solid = np.where(self.is_bed,
                                   S['rho_bulk'] * S['cp_bed'],
                                   7900.0 * 500.0)[:, None] * np.ones((1, nt))
        # the drawing packs the annulus to 83 % to leave a settling allowance;
        # smear the DESIGN carbon mass over the full annulus so the simulated
        # tube holds exactly the carbon the machine was sized with
        V_ann = math.pi * (r_wi ** 2 - r_i ** 2) * self.L
        self.m_c_tube = S['m_c_tube'] if 'm_c_tube' in S else IM.design()['m_c'] / S['n_tube']
        self.rho_bed = self.m_c_tube / V_ann
        self.rhoc_solid[:nr, :] = self.rho_bed * S['cp_bed']

        # cell volumes and face areas
        self.V = (self.r * self.dr)[:, None] * self.dth * self.L * np.ones((1, nt))
        self.V_bed = np.where(self.is_bed[:, None], self.V, 0.0)
        self.m_bed = self.V_bed * self.rho_bed          # kg carbon per cell

        # radial face conductance between cell i and i+1 (harmonic k)
        kf = np.zeros((self.n - 1, nt))
        for i in range(self.n - 1):
            ka, kb = self.k[i], self.k[i + 1]
            da, db = self.dr[i], self.dr[i + 1]
            kf[i] = (da + db) / (da / ka + db / kb)
        A_rf = self.rf[1:-1][:, None] * self.dth * self.L * np.ones((1, nt))
        dist_r = 0.5 * (self.dr[:-1] + self.dr[1:])[:, None]
        self.G_r = kf * A_rf / dist_r                   # W/K, (n-1, nt)

        # angular face conductance (same cell ring, periodic)
        A_tf = self.dr[:, None] * self.L * np.ones((1, nt))
        dist_t = (self.r[:, None] * self.dth) * np.ones((1, nt))
        self.G_t = self.k * A_tf / dist_t               # W/K, (n, nt)

        # ---- outer boundary, split by theta --------------------------------
        A_out = r_wo * self.dth * self.L                # m2 per angular cell
        self.A_out = A_out
        self.bond = np.abs(np.where(self.th > math.pi, 2 * math.pi - self.th, self.th)) <= self.theta_bond
        self.G_bond = np.where(self.bond, h_contact * A_out, 0.0)
        self.axisym = axisym
        if axisym:
            # same TOTAL bond conductance, smeared over the whole circumference:
            # this is the theta-uniform (1D radial) comparison case, used to
            # isolate how much the real top-fed geometry actually costs
            tot = float(self.G_bond.sum())
            self.G_bond = np.full(nt, tot / nt)
            self.bond = np.ones(nt, bool)
        U_back = S['k_ins'] / (S['ins_back'] / 1000.0)  # 0.024 / 0.050
        frac_back = 1.0 - (2 * self.theta_bond) / (2 * math.pi)
        if back_full:
            # control: hold the back-loss AREA fixed while the bond arc varies,
            # so a bond-arc comparison is not quietly also a loss-area comparison
            self.G_back = np.full(nt, U_back * A_out * (1.0 - 60.0 / 360.0))
        elif axisym:
            self.G_back = np.full(nt, U_back * A_out * frac_back)
        else:
            self.G_back = np.where(self.bond, 0.0, U_back * A_out)

        # ---- absorber plate node (one strip per tube) ----------------------
        self.A_plate = (S['A_coll'] / S['n_tube'])
        self.C_plate = self.A_plate * 0.5e-3 * 8960.0 * 385.0
        self.alpha = 0.95

        # inventory
        d = IM.design()
        # the drawing's charge is exactly x_rich(30 C) x m_c, so the machine
        # physically cannot hold more methanol than the 30 C rich state. Once a
        # night cooling path takes the bed below 30 C the evaporator runs dry and
        # the extra swing is unreachable - charge and night cooling are coupled.
        self.charge_scale = charge_scale
        self.M_tot_tube = d['charge'] / S['n_tube'] * charge_scale
        self.P_ev, self.P_cd = psat_meoh(S['T_evap']), psat_meoh(S['T_cond'])
        self.design = d

    # -------------------------------------------------------------- helpers
    def U_loss(self, dT):
        """Collector loss coefficient, EN 12975 form, W/m2K."""
        return 3.5 + 0.015 * max(dT, 0.0)

    def M_ads(self, T, P):
        x, _, _ = uptake(T, P)
        return float(np.sum(self.m_bed * x))

    def solve_P(self, T, M_target, lo=None, hi=None):
        """Isosteric leg: find P with integral(x dV) = M_target."""
        lo = self.P_ev * 0.05 if lo is None else lo
        hi = psat_meoh(S['T_stag']) * 2.0 if hi is None else hi
        f_lo = self.M_ads(T, lo) - M_target
        f_hi = self.M_ads(T, hi) - M_target
        if f_lo > 0:  return lo
        if f_hi < 0:  return hi
        for _ in range(60):
            mid = math.sqrt(lo * hi)
            if self.M_ads(T, mid) - M_target < 0: lo = mid
            else: hi = mid
        return math.sqrt(lo * hi)

    # ----------------------------------------------------------------- run
    def run(self, hours=24.0, t_start=6.0, cfl=0.65, n_frames=96,
            T0=None, P_update_every=40, prop_every=10, verbose=True,
            state=None):
        n, nt = self.n, self.nt
        if state is None:
            T = np.full((n, nt), S['T_ads'] if T0 is None else T0)
            Tp = float(T[0, 0])
            P = self.P_ev
            M_ads = self.M_ads(T, P)
            M_liq = max(self.M_tot_tube - M_ads, 0.0)
            M_ads = min(M_ads, self.M_tot_tube)
            phase = "adsorb"
        else:
            T = state['T'].copy(); Tp = state['Tp']
            P = state['P']; M_ads = state['M_ads']; M_liq = state['M_liq']
            phase = state['phase']

        # ---- explicit time step from the cell conductance sums ------------
        Gsum = np.zeros((n, nt))
        Gsum[:-1] += self.G_r; Gsum[1:] += self.G_r
        Gsum += 2 * self.G_t
        Gsum[-1] += self.G_bond + self.G_back
        C_min = np.min(self.rhoc_solid * self.V)
        dt = cfl * float(np.min((self.rhoc_solid * self.V) / Gsum))
        nstep = int(hours * 3600.0 / dt)
        if verbose:
            print(f"   grid {n} x {nt}   dt = {dt:.3f} s   steps = {nstep}")

        frames, trace = [], []
        f_every = max(1, nstep // n_frames)
        C_fix = self.rhoc_solid * self.V
        hfg_ev = hfg_meoh(S['T_evap'])
        h_ads = 1.33 * hfg_ev
        E_in = E_out = E_lat = 0.0
        M_evap_total = 0.0
        P_prev = P

        for step in range(nstep):
            t = t_start + step * dt / 3600.0
            t_h = t % 24.0
            G = solar(t_h, self.H_day)
            Ta = ambient(t_h)

            # ---------- pressure / phase bookkeeping ----------------------
            if step % P_update_every == 0:
                P_old = P
                if phase == "heat":
                    P = self.solve_P(T, M_ads)
                    if P >= self.P_cd:
                        P, phase = self.P_cd, "desorb"
                elif phase == "desorb":
                    P = self.P_cd
                    M_new = self.M_ads(T, P)
                    if M_new > M_ads + 1e-9:        # bed cooling, cannot re-boil
                        phase = "cool"
                        P = self.solve_P(T, M_ads)
                    else:
                        M_liq += M_ads - M_new
                        M_ads = M_new
                elif phase == "cool":
                    P = self.solve_P(T, M_ads)
                    if P <= self.P_ev:
                        P, phase = self.P_ev, "adsorb"
                elif phase == "adsorb":
                    P = self.P_ev
                    M_new = self.M_ads(T, P)
                    if M_new < M_ads - 1e-9:        # bed warming -> isosteric
                        phase = "heat"
                        P = self.solve_P(T, M_ads)
                    else:
                        take = min(M_new - M_ads, M_liq)
                        M_ads += take; M_liq -= take
                        M_evap_total += take
                        if take < (M_new - M_ads) - 1e-12:
                            P = self.solve_P(T, M_ads)   # evaporator dry
                # dP/dt is held piecewise constant across the whole update
                # interval.  It must be: in an isosteric leg the dx/dT and
                # dx/dP terms cancel under the volume integral, so clipping
                # one of them to a single step would have the bed soak latent
                # heat it never actually soaks.
                dPdt = (P - P_old) / (P_update_every * dt)

            # ---------- effective capacity ---------------------------------
            # the DA properties move on the thermal timescale (minutes), not on
            # dt (0.25 s), so refreshing them every prop_every steps costs
            # nothing physically and buys most of the runtime back
            if step % prop_every == 0:
                x, dxdT, dxdP = uptake(T, P)
                Cb = np.maximum(np.where(
                    self.is_bed[:, None],
                    self.m_bed * (S['cp_bed'] + x * 2500.0 - h_ads * dxdT),
                    C_fix), 1e-9)
                src = np.where(self.is_bed[:, None],
                               self.m_bed * h_ads * dxdP * dPdt, 0.0)

            # ---------- conduction -----------------------------------------
            q = np.zeros((n, nt))
            fr = self.G_r * (T[1:] - T[:-1])
            q[:-1] += fr; q[1:] -= fr
            ft = self.G_t * (np.roll(T, -1, axis=1) - T)
            q += ft - np.roll(ft, 1, axis=1)

            # ---------- outer boundary -------------------------------------
            q[-1] += self.G_bond * (Tp - T[-1]) + self.G_back * (Ta - T[-1])

            T = T + dt * (q + src) / Cb

            # ---------- plate node -----------------------------------------
            UL = self.U_loss(Tp - Ta)
            if self.night_vent and G <= 0.0:
                UL = self.U_night if self.U_night else UL
            Q_sun = self.alpha * G * self.A_plate
            Q_loss = UL * self.A_plate * (Tp - Ta)
            Q_tube = float(np.sum(self.G_bond * (Tp - T[-1])))
            Tp = Tp + dt * (Q_sun - Q_loss - Q_tube) / self.C_plate
            E_in += Q_sun * dt; E_out += Q_loss * dt

            # ---------- capture --------------------------------------------
            if step % f_every == 0 or step == nstep - 1:
                Tb = T[self.is_bed]; xb = x[self.is_bed]; mb = self.m_bed[self.is_bed]
                i_top, i_bot = 0, nt // 2
                trace.append(dict(
                    t=t_h, phase=phase, P=P, Tp=Tp, Ta=Ta, G=G,
                    T_mean=float(np.sum(Tb * mb) / np.sum(mb)),
                    T_top=float(T[:, i_top][self.is_bed].mean()),
                    T_bot=float(T[:, i_bot][self.is_bed].mean()),
                    T_wall_top=float(T[-1, i_top]), T_wall_bot=float(T[-1, i_bot]),
                    T_core_top=float(T[0, i_top]), T_core_bot=float(T[0, i_bot]),
                    x_mean=float(np.sum(xb * mb) / np.sum(mb)),
                    x_top=float(x[:, i_top][self.is_bed].mean()),
                    x_bot=float(x[:, i_bot][self.is_bed].mean()),
                    M_ads=M_ads, M_liq=M_liq, M_evap=M_evap_total))
                frames.append((T.copy(), x.copy()))

            if verbose and step % max(1, nstep // 8) == 0:
                print(f"      t={t_h:5.2f} h  {phase:<7s} P={P/1000:7.2f} kPa"
                      f"  Tmean={float(T[self.is_bed].mean()):6.1f}"
                      f"  Ttop={float(T[-1,0]):6.1f}  Tbot={float(T[-1,nt//2]):6.1f}"
                      f"  x={self.M_ads(T,P)/self.m_c_tube:5.3f}")

        return dict(T=T, frames=frames, trace=trace, dt=dt,
                    M_evap=M_evap_total, m_c_tube=self.m_c_tube,
                    E_in=E_in, E_out=E_out, rho_bed=self.rho_bed,
                    state=dict(T=T.copy(), Tp=Tp, P=P, M_ads=M_ads,
                               M_liq=M_liq, phase=phase))

    # ------------------------------------------------- periodic steady state
    def run_periodic(self, max_days=8, tol=0.3, verbose=True, **kw):
        """Repeat the day until it repeats. A single day from a cold rich
        start is meaningless here: the bed does not return to its starting
        state overnight, so day 1 reports the initial condition, not the
        machine."""
        st, hist = None, []
        for d in range(max_days):
            # every day starts with the receiver drained back to the evaporator
            if st is not None:
                st = dict(st); st['M_liq'] = self.M_tot_tube - st['M_ads']
            r = self.run(state=st, verbose=False, **kw)
            st = r['state']
            T0m = float(r['trace'][0]['T_mean']); T1m = float(r['trace'][-1]['T_mean'])
            tr = r['trace']
            sw = max(t['x_mean'] for t in tr) - min(t['x_mean'] for t in tr)
            hist.append(dict(day=d + 1, T_start=T0m, T_end=T1m,
                             swing=sw, M_evap=r['M_evap']))
            if verbose:
                print(f"      day {d+1}: start {T0m:5.1f} C  end {T1m:5.1f} C"
                      f"  swing {sw:5.3f}  evap {r['M_evap']*1000:5.0f} g/tube")
            if abs(T1m - T0m) < tol and d >= 1:
                break
        r['days'] = hist
        return r


# ------------------------------------------------------------------- report
def ice_from(M_evap_tube):
    """Ice per day from the methanol actually evaporated, all 8 tubes."""
    d = IM.design(); x = IM.exchangers()
    Q_cool = M_evap_tube * S['n_tube'] * hfg_meoh(S['T_evap'])
    Q_leak = x['Q_leak'] * 12 * 3600.0
    return max(Q_cool - Q_leak, 0.0) / d['q_ice'], Q_cool, Q_leak


if __name__ == "__main__":
    P_ = print; L = lambda c='-': P_(c * 78)
    P_("=" * 78); P_("SI-100 ADSORBER  —  2D (r, theta) TRANSIENT, ONE FULL DAY"); P_("=" * 78)
    m = Adsorber2D()
    P_(f"   one tube: carbon {m.m_c_tube*1000:.0f} g smeared at {m.rho_bed:.0f} kg/m3"
       f" over the full annulus  (drawing packs 83 % of {S['rho_bulk']:.0f} kg/m3)")
    P_(f"   bond arc +/-{math.degrees(m.theta_bond):.0f} deg, contact {m.h_contact:.0f} W/m2K,"
       f" back loss {S['k_ins']/(S['ins_back']/1000):.2f} W/m2K")
    P_(f"   methanol per tube {m.M_tot_tube*1000:.0f} g   P_ev {m.P_ev/1000:.2f} kPa"
       f"   P_cd {m.P_cd/1000:.2f} kPa")
    P_("")
    r = m.run()
    tr = r['trace']
    P_("")
    L('='); P_("RESULT"); L('=')
    x_hi = max(t['x_mean'] for t in tr); x_lo = min(t['x_mean'] for t in tr)
    P_(f"   x rich achieved      {x_hi:6.3f} kg/kg   (design {m.design['x_r']:.3f})")
    P_(f"   x lean achieved      {x_lo:6.3f} kg/kg   (design {m.design['x_l']:.3f})")
    P_(f"   swing achieved       {x_hi-x_lo:6.3f} kg/kg   (design {m.design['dx']:.3f})"
       f"   = {(x_hi-x_lo)/m.design['dx']*100:.0f} % of design")
    ice, Qc, Ql = ice_from(r['M_evap'])
    P_(f"   methanol evaporated  {r['M_evap']*S['n_tube']*1000:6.0f} g/day")
    P_(f"   ICE                  {ice:6.2f} kg/day   (target {S['ice_day']:.1f})")
    tmax = max(tr, key=lambda t: t['T_mean'])
    P_(f"\n   peak bed mean {tmax['T_mean']:.1f} C at {tmax['t']:.2f} h"
       f"   top {tmax['T_top']:.1f}  bottom {tmax['T_bot']:.1f}"
       f"   split {tmax['T_top']-tmax['T_bot']:.1f} K")
    tmin = min(tr, key=lambda t: t['T_mean'])
    P_(f"   coldest bed mean {tmin['T_mean']:.1f} C at {tmin['t']:.2f} h"
       f"   (adsorption needs {S['T_ads']:.0f})")
