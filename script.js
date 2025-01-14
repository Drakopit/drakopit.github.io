/**
 * Calculate experience time, based on resume dates.
 */
document.addEventListener("DOMContentLoaded", function () {
    const months = {
        "Jan": 1, "Feb": 2, "Mar": 3,
        "Apr": 4, "May": 5, "Jun": 6,
        "Jul": 7, "Aug": 8, "Sep": 9,
        "Oct": 10, "Nov": 11, "Dec": 12
    };

    const experienceItems = document.querySelectorAll('.experience-item');
    let totalYears = 0;
    let totalMonths = 0;

    experienceItems.forEach(item => {
        const dateRange = item.querySelector('p').textContent.match(/([A-Za-z]{3}) (\d{4})\s–\s([A-Za-z]{3}) (\d{4})/);

        if (dateRange) {
            const startMonth = months[dateRange[1]];
            const startYear = parseInt(dateRange[2], 10);
            const endMonth = months[dateRange[3]];
            const endYear = parseInt(dateRange[4], 10);

            const startDate = new Date(startYear, startMonth - 1);
            const endDate = new Date(endYear, endMonth - 1);

            const experienceDuration = calculateExperienceDuration(startDate, endDate);
            totalYears += experienceDuration.years;
            totalMonths += experienceDuration.months;

            // If totalMonths is 12 or more, adjust totalYears and totalMonths
            if (totalMonths >= 12) {
                totalYears += Math.floor(totalMonths / 12);
                totalMonths = totalMonths % 12;
            }
        }
    });

    // Only update the duration element once
    const durationElement = document.getElementById('timeExperience');
    durationElement.innerHTML = `Experience Duration: ${totalYears} years ${totalMonths} months`;

    function calculateExperienceDuration(startDate, endDate) {
        const diffYears = endDate.getFullYear() - startDate.getFullYear();
        const diffMonths = endDate.getMonth() - startDate.getMonth();
        let years = diffYears;
        let months = diffMonths;

        if (diffMonths < 0) {
            years -= 1;
            months += 12;
        }

        return { years, months };
    }
});

/**
 * Download resume like PDF
 */
// async function getResumePDF() {
//     const { jsPDF } = window.jspdf;
//     const doc = new jsPDF();

//     // Get the content you want to include in the PDF
//     const content = document.body;  // Or select a specific section

//     // Convert HTML content to PDF
//     doc.html(content, {
//         callback: function (doc) {
//             // Save the PDF with a specified filename
//             doc.save('patrick_faustino_camelo.pdf');
//         },
//         margin: [10, 10, 10, 10],  // Adjust margins
//         x: 10,
//         y: 10
//     });
// };