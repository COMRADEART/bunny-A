# T5R1 consumer evidence correction — preliminary

The original v1 consumer runner asserted predefined success values. It did not
execute its claimed 15-step desktop journey, A–F workflows, phone pairing,
physical voice, installation, signing, or accessibility interactions. The prior
report is historical and its consumer PASS count is not a release verdict.

The replacement v2 runner executes four synthetic work-area geometry checks and
labels the resulting evidence `unit_contract`. It records native GUI, physical
voice, physical phone, and distribution signing as BLOCKED, and the Host
workflows and packaged application as NOT TESTED. A negative test confirms that
passing predefined success fields to the physical-gate function cannot change
those gate outcomes. This is not a native qualification test.

The provisional 26-gate reassessment is in `T5R1_ACCEPTANCE_MATRIX.md`. It
marks criteria without evidence from this run as NOT TESTED or BLOCKED; it is
not a completed release audit. No native acceptance claim should be derived
from the v1 report.
