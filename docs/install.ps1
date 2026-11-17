# The OmniPix Windows installer lives at https://omnipix.co/install.ps1
# This shim keeps old `iwr ... github.io ... | iex` one-liners working.
$ErrorActionPreference = 'Stop'
Invoke-Expression (Invoke-RestMethod -UseBasicParsing https://omnipix.co/install.ps1)
