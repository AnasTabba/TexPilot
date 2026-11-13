"""Incoming-fabric QC research and release tooling (plan T09-T12).

Pure record-processing code: manifests, split audits, reference eligibility, enrolment
arithmetic, export and training-input guards, ablation and release statistics. Nothing here
trains a model, talks to Kaggle or approves an external gate (G1-G8); every function works on
records the caller supplies and fails closed when evidence is missing.
"""
