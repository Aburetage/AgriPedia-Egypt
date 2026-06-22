param(
    [Parameter(Mandatory = $true)][string]$SourceDocx,
    [Parameter(Mandatory = $true)][string]$OutputJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-WordBody {
    param([string]$Path)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entry = $zip.GetEntry('word/document.xml')
        if (-not $entry) { throw "word/document.xml was not found in $Path" }

        $reader = [System.IO.StreamReader]::new($entry.Open())
        try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }

        $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
        $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')

        $result = @()
        foreach ($node in $xml.SelectSingleNode('//w:body', $ns).ChildNodes) {
            if ($node.LocalName -eq 'p') {
                $text = (($node.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join '').Trim()
                if (-not $text) { continue }

                $styleNode = $node.SelectSingleNode('./w:pPr/w:pStyle', $ns)
                $style = if ($styleNode) {
                    $styleNode.GetAttribute('val', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
                } else {
                    ''
                }

                $result += [pscustomobject]@{
                    Kind   = 'Paragraph'
                    Text   = $text
                    Style  = $style
                    IsList = [bool]$node.SelectSingleNode('./w:pPr/w:numPr', $ns)
                }
            }
            elseif ($node.LocalName -eq 'tbl') {
                $rows = @()
                foreach ($tableRow in $node.SelectNodes('./w:tr', $ns) | Select-Object -Skip 1) {
                    $cells = @($tableRow.SelectNodes('./w:tc', $ns) | ForEach-Object {
                        (($_.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join '').Trim()
                    })
                    if ($cells.Count -eq 2) {
                        $rows += [ordered]@{ label = $cells[0]; value = $cells[1] }
                    }
                }
                $result += [pscustomobject]@{ Kind = 'Table'; Rows = $rows }
            }
        }

        return $result
    }
    finally {
        $zip.Dispose()
    }
}

$paragraphs = @(Read-WordBody -Path $SourceDocx)
$referencesStart = -1
for ($index = 0; $index -lt $paragraphs.Count; $index++) {
    if ($paragraphs[$index].Kind -eq 'Paragraph' -and $paragraphs[$index].Text -match '^1\. European and Mediterranean Plant Protection Organization') {
        $referencesStart = $index - 1
        break
    }
}
if ($referencesStart -lt 0) { throw 'The references heading was not found in the source document.' }

$bodyParagraphs = @($paragraphs | Select-Object -First $referencesStart)
$referenceParagraphs = @($paragraphs | Select-Object -Skip ($referencesStart + 1))
$references = @()
for ($index = 0; $index -lt $referenceParagraphs.Count; $index += 2) {
    if ($index + 1 -ge $referenceParagraphs.Count) { throw 'A reference URL is missing.' }
    $text = $referenceParagraphs[$index].Text -replace '^\d+\.\s*', ''
    $url = $referenceParagraphs[$index + 1].Text
    if ($url -notmatch '^https?://') { throw "Invalid reference URL: $url" }
    $references += [ordered]@{
        number = $references.Count + 1
        text   = $text
        url    = $url
    }
}

$items = [System.Collections.ArrayList]::new()
$listItems = @()
$openingHeadingCount = 0
$insidePromotedSection = $false

function Flush-List {
    if ($script:listItems.Count -gt 0) {
        [void]$script:items.Add([ordered]@{ type = 'doc-list'; items = @($script:listItems) })
        $script:listItems = @()
    }
}

foreach ($paragraph in $bodyParagraphs) {
    if ($paragraph.Kind -eq 'Table') {
        Flush-List
        [void]$items.Add([ordered]@{ type = 'doc-table'; rows = @($paragraph.Rows) })
        continue
    }

    if ($paragraph.IsList) {
        $listItems += $paragraph.Text
        continue
    }

    Flush-List

    if ($paragraph.Style -match '^Heading([1-4])$') {
        $sourceLevel = [int]$Matches[1]
        $level = $sourceLevel

        if ($sourceLevel -eq 1) {
            $openingHeadingCount++
            if ($openingHeadingCount -gt 2) {
                $level = 2
                $insidePromotedSection = $true
            }
        }
        elseif ($insidePromotedSection) {
            $level = [Math]::Min($sourceLevel + 1, 4)
        }

        [void]$items.Add([ordered]@{
            type  = 'doc-heading'
            level = $level
            text  = $paragraph.Text
        })
    }
    elseif ($paragraph.Style -eq 'BlockText') {
        [void]$items.Add([ordered]@{ type = 'doc-quote'; text = $paragraph.Text })
    }
    else {
        [void]$items.Add([ordered]@{ type = 'doc-paragraph'; text = $paragraph.Text })
    }
}
Flush-List

[void]$items.Add([ordered]@{
    type  = 'doc-heading'
    level = 1
    text  = $paragraphs[$referencesStart].Text
    id    = 'chapter-two-references'
})
[void]$items.Add([ordered]@{ type = 'reference-list'; items = $references })

$chapter = Get-Content -Raw -Encoding UTF8 $OutputJson | ConvertFrom-Json
$newTab = [pscustomobject]@{
    tab_title      = $bodyParagraphs[1].Text
    content_blocks = @(
        [pscustomobject]@{
            type  = 'doc-article'
            items = @($items)
            meta  = [pscustomobject]@{ updated_at = '2026-06-20' }
        }
    )
}

$keptTabs = @($chapter.tabs | Select-Object -First 1)
$chapter.tabs = @($keptTabs) + @($newTab)

$json = $chapter | ConvertTo-Json -Depth 14 -Compress
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($OutputJson, $json + [Environment]::NewLine, $utf8NoBom)

Write-Output "Imported chapter two with $($items.Count) structured items and $($references.Count) references into $OutputJson"
